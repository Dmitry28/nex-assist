import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SnapshotService } from '../../common/snapshot.service';
import { SourceHealthService } from '../../common/source-health.service';
import { sleep } from '../../common/utils/sleep';
import type { IdriverFeedConfig } from '../../config/idriver.config';
import { IdriverNotifierService, type IdriverNotifyResult } from './idriver-notifier.service';
import { IdriverParserService } from './idriver-parser.service';
import { INTER_FEED_DELAY_MS, RETENTION_DAYS, RUN_TIMEOUT_MS, dataFile } from './constants';
import {
  isIdriverSnapshotEntry,
  type IdriverFeedResult,
  type IdriverListing,
  type IdriverResult,
  type IdriverSnapshotEntry,
} from './dto/idriver-listing.dto';

/**
 * Orchestrates the idriver.by scrape cycle, one catalogue page per car:
 *   1. Fetch the newest page of the model catalogue (every part, newest first).
 *   2. Keep the listings whose donor year fits the owner's car.
 *   3. Diff those against the snapshot → new listings.
 *   4. Notify — only what was successfully sent gets persisted.
 *
 * Two differences from the bamper.by module, both forced by the source:
 *
 * • **No removals.** A run sees the newest page, not the full set for a part, so a listing that
 *   is absent may simply have been pushed down the list. Snapshot entries are therefore aged out
 *   after RETENTION_DAYS instead of being dropped when they disappear.
 * • **A year filter in code.** idriver URLs carry no year parameter, so the 2023+ window that
 *   the bamper feeds encode in their URLs is applied after parsing.
 */
@Injectable()
export class IdriverService {
  private readonly logger = new Logger(IdriverService.name);
  private isRunning = false;

  constructor(
    private readonly config: ConfigService,
    private readonly parser: IdriverParserService,
    private readonly snapshot: SnapshotService,
    private readonly notifier: IdriverNotifierService,
    private readonly health: SourceHealthService,
  ) {}

  async run(): Promise<IdriverResult> {
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

  private async scrape(): Promise<IdriverResult> {
    const feeds = this.config.get<IdriverFeedConfig[]>('idriver.feeds') ?? [];
    const minYear = this.config.get<number>('idriver.minYear') ?? 0;

    const feedResults: IdriverFeedResult[] = [];
    const matchingByFeed = new Map<string, IdriverListing[]>();
    const previousByFeed = new Map<string, Map<string, IdriverSnapshotEntry>>();
    const failedFeeds: string[] = [];
    let lastFetchError: unknown;

    for (const [i, feed] of feeds.entries()) {
      if (i > 0) await sleep(INTER_FEED_DELAY_MS);

      let current: IdriverListing[];
      let previousEntries: IdriverSnapshotEntry[];
      try {
        [current, previousEntries] = await Promise.all([
          this.parser.fetch(feed.url, feed.key),
          this.snapshot.read(dataFile(feed.key), isIdriverSnapshotEntry),
        ]);
      } catch (error) {
        lastFetchError = error;
        failedFeeds.push(feed.car);
        this.logger.error(
          `Feed ${feed.key}: fetch failed — ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }

      const previousMap = new Map(previousEntries.map(e => [e.id, e]));

      // Health is measured on the whole page, not on the year-filtered subset: an empty page
      // means the source broke, while an empty filtered subset is the normal state here.
      const { alert } = await this.health.record(
        `idriver:${feed.key}`,
        current.length,
        previousEntries.length > 0,
      );
      if (alert) await this.notifier.notifyError(alert);

      if (current.length === 0) {
        this.logger.warn(`Feed ${feed.key}: page parsed to 0 listings — skipping diff`);
        continue;
      }

      // Year unknown is kept: the site omits it on a minority of cards, and a missed fit costs
      // more than one extra card in the channel.
      const matching = current.filter(l => l.year === undefined || l.year >= minYear);
      const newListings = matching.filter(l => !previousMap.has(l.id));
      // Nothing on the page was seen before, yet we had a snapshot: the catalogue turned over
      // entirely between runs, so arrivals could have scrolled off unseen.
      const mayHaveMissed =
        previousMap.size > 0 && current.every(l => !previousMap.has(l.id)) && matching.length > 0;

      const result: IdriverFeedResult = {
        feedKey: feed.key,
        car: feed.car,
        url: feed.url,
        total: current.length,
        matching: matching.length,
        newListings,
        isBaseline: previousMap.size === 0 && matching.length > 0,
        mayHaveMissed,
      };
      this.logger.log(
        `Diff [${feed.key}] — page: ${result.total}, ${minYear}+: ${matching.length}, new: ${newListings.length}${result.isBaseline ? ' [BASELINE]' : ''}`,
      );

      feedResults.push(result);
      matchingByFeed.set(feed.key, matching);
      previousByFeed.set(feed.key, previousMap);
    }

    if (feeds.length > 0 && failedFeeds.length === feeds.length) {
      throw lastFetchError instanceof Error
        ? lastFetchError
        : new Error(`All ${feeds.length} idriver feeds failed`);
    }

    const aggregate: IdriverResult = { feeds: feedResults, failedFeeds };
    const notifyResult = await this.notifier.notifyRunResult(aggregate);

    for (const feed of feeds) {
      const matching = matchingByFeed.get(feed.key);
      const previousMap = previousByFeed.get(feed.key);
      if (!matching || !previousMap) continue;
      await this.persistSnapshot(feed, matching, previousMap, notifyResult);
    }

    return aggregate;
  }

  private async persistSnapshot(
    feed: IdriverFeedConfig,
    matching: IdriverListing[],
    previousMap: Map<string, IdriverSnapshotEntry>,
    notifyResult: IdriverNotifyResult,
  ): Promise<void> {
    const now = new Date();
    const nowIso = now.toISOString();

    const updated = new Map(previousMap);
    for (const listing of matching) {
      const prev = updated.get(listing.id);
      if (!prev) {
        // New listing — persist only if notified, so a Telegram failure retries next run.
        if (notifyResult.notifiedNew.has(listing.id)) {
          updated.set(listing.id, { ...listing, firstSeenAt: nowIso, lastSeenAt: nowIso });
        }
      } else {
        updated.set(listing.id, { ...prev, ...listing, lastSeenAt: nowIso });
      }
    }

    // Age out instead of pruning by absence — see the class comment.
    const cutoff = now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const [id, entry] of [...updated]) {
      if (new Date(entry.lastSeenAt).getTime() < cutoff) updated.delete(id);
    }

    const pending = matching.filter(
      l => !previousMap.has(l.id) && !notifyResult.notifiedNew.has(l.id),
    ).length;
    if (pending > 0) {
      this.logger.warn(
        `Feed ${feed.key}: ${pending} new listing(s) not persisted — send failed, retry next run`,
      );
    }

    await this.snapshot.write(dataFile(feed.key), [...updated.values()]);
    this.logger.log(`Feed ${feed.key}: snapshot saved (${updated.size} entries)`);
  }
}
