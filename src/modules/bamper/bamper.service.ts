import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SnapshotService } from '../../common/snapshot.service';
import { sleep } from '../../common/utils/sleep';
import type { BamperFeedConfig } from '../../config/bamper.config';
import { BamperNotifierService, type BamperNotifyResult } from './bamper-notifier.service';
import { BamperParserService } from './bamper-parser.service';
import { INTER_FEED_DELAY_MS, RUN_TIMEOUT_MS, dataFile } from './constants';
import {
  isBamperSnapshotEntry,
  type BamperFeedResult,
  type BamperListing,
  type BamperResult,
  type BamperSnapshotEntry,
} from './dto/bamper-listing.dto';

/** Extract the bamper.by part slug from a feed URL: .../zapchast_<slug>/... */
const partSlugOf = (url: string): string => url.match(/zapchast_([^/]+)/)?.[1] ?? '';

/**
 * Orchestrates the bamper.by scrape cycle across all configured part feeds
 * (rear bumper, tailgate, …) for the VW Atlas Cross Sport:
 *   1. Fetch current listings per feed (Puppeteer, behind Cloudflare).
 *   2. Diff each against its snapshot → new / removed listings.
 *   3. Notify new listings — only what was successfully sent gets persisted.
 *   4. Persist the updated per-feed snapshots.
 *
 * Every feed URL already narrows to the Atlas Cross Sport, restyle years (2023-2026),
 * so every listing is a compatibility candidate for the owner's 2025 car.
 */
@Injectable()
export class BamperService {
  private readonly logger = new Logger(BamperService.name);
  private isRunning = false;

  constructor(
    private readonly config: ConfigService,
    private readonly parser: BamperParserService,
    private readonly snapshot: SnapshotService,
    private readonly notifier: BamperNotifierService,
  ) {}

  async run(): Promise<BamperResult> {
    if (this.isRunning) throw new ConflictException('Scrape already in progress');
    this.isRunning = true;

    const watchdog = setTimeout(() => {
      this.logger.error(`Scrape watchdog fired after ${RUN_TIMEOUT_MS / 1000}s — resetting lock`);
      this.isRunning = false;
    }, RUN_TIMEOUT_MS);

    try {
      return await this.scrape();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Critical scrape failure', error);
      try {
        await this.notifier.notifyError(message);
      } catch {
        this.logger.warn('Failed to send error notification to Telegram');
      }
      throw error;
    } finally {
      clearTimeout(watchdog);
      this.isRunning = false;
    }
  }

  private async scrape(): Promise<BamperResult> {
    const feeds = this.config.get<BamperFeedConfig[]>('bamper.feeds') ?? [];

    const feedResults: BamperFeedResult[] = [];
    const currentByFeed = new Map<string, BamperListing[]>();
    const previousByFeed = new Map<string, Map<string, BamperSnapshotEntry>>();

    for (const [i, feed] of feeds.entries()) {
      if (i > 0) await sleep(INTER_FEED_DELAY_MS);

      const [current, previousEntries] = await Promise.all([
        this.parser.fetch(feed.url, partSlugOf(feed.url)),
        this.snapshot.read(dataFile(feed.key), isBamperSnapshotEntry),
      ]);

      const previousMap = new Map(previousEntries.map(e => [e.id, e]));

      // Defensive: never wipe a non-empty snapshot if the parser yields nothing (e.g. a
      // Cloudflare block that slipped through) — that would re-notify everything next run.
      if (current.length === 0 && previousEntries.length > 0) {
        this.logger.warn(`Feed ${feed.key}: 0 listings but snapshot non-empty — skipping diff`);
        feedResults.push({
          feedKey: feed.key,
          label: feed.label,
          total: previousEntries.length,
          newListings: [],
          removedListings: [],
          isBaseline: false,
        });
        continue;
      }

      const currentIds = new Set(current.map(c => c.id));
      const isBaseline = previousMap.size === 0 && current.length > 0;
      const newListings = current.filter(c => !previousMap.has(c.id));
      const removedListings = previousEntries.filter(p => !currentIds.has(p.id));

      const result: BamperFeedResult = {
        feedKey: feed.key,
        label: feed.label,
        total: current.length,
        newListings,
        removedListings,
        isBaseline,
      };
      this.logger.log(
        `Diff [${feed.key}] — total: ${result.total}, new: ${newListings.length}, removed: ${removedListings.length}${isBaseline ? ' [BASELINE]' : ''}`,
      );

      feedResults.push(result);
      currentByFeed.set(feed.key, current);
      previousByFeed.set(feed.key, previousMap);
    }

    const aggregate: BamperResult = { feeds: feedResults };
    const notifyResult = await this.notifier.notifyRunResult(aggregate);

    for (const feed of feeds) {
      const current = currentByFeed.get(feed.key);
      const previousMap = previousByFeed.get(feed.key);
      const feedResult = feedResults.find(r => r.feedKey === feed.key);
      // Skip feeds that had no successful fetch this run (e.g. defensive 0-result skip).
      if (!current || !previousMap || !feedResult) continue;
      await this.persistSnapshot(feed, current, previousMap, feedResult, notifyResult);
    }

    return aggregate;
  }

  private async persistSnapshot(
    feed: BamperFeedConfig,
    current: BamperListing[],
    previousMap: Map<string, BamperSnapshotEntry>,
    result: BamperFeedResult,
    notifyResult: BamperNotifyResult,
  ): Promise<void> {
    const now = new Date().toISOString();

    // Baseline: persist everything unconditionally — no per-listing messages were sent.
    if (result.isBaseline) {
      const seeded = current.map<BamperSnapshotEntry>(l => ({
        ...l,
        firstSeenAt: now,
        lastSeenAt: now,
      }));
      await this.snapshot.write(dataFile(feed.key), seeded);
      this.logger.log(`Feed ${feed.key}: baseline saved (${seeded.length} entries, no messages)`);
      return;
    }

    const updated = new Map(previousMap);
    for (const listing of current) {
      const prev = updated.get(listing.id);
      if (!prev) {
        // New listing — persist only if notified, so a Telegram failure retries next run.
        if (notifyResult.notifiedNew.has(listing.id)) {
          updated.set(listing.id, { ...listing, firstSeenAt: now, lastSeenAt: now });
        }
      } else {
        updated.set(listing.id, { ...prev, ...listing, lastSeenAt: now });
      }
    }

    // Drop entries that disappeared from the current results.
    const currentIds = new Set(current.map(c => c.id));
    for (const id of [...updated.keys()]) {
      if (!currentIds.has(id)) updated.delete(id);
    }

    const pending = result.newListings.filter(l => !notifyResult.notifiedNew.has(l.id)).length;
    if (pending > 0) {
      this.logger.warn(
        `Feed ${feed.key}: ${pending} new listing(s) not persisted — send failed, retry next run`,
      );
    }

    await this.snapshot.write(dataFile(feed.key), [...updated.values()]);
    this.logger.log(`Feed ${feed.key}: snapshot saved (${updated.size} entries)`);
  }
}
