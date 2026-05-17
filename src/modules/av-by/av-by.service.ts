import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import path from 'path';
import { SnapshotService } from '../../common/snapshot.service';
import { sleep } from '../../common/utils/sleep';
import type { AvByFeedConfig } from '../../config/av-by.config';
import { AvByNotifierService, AvByNotifyResult } from './av-by-notifier.service';
import { AvByParserService } from './av-by-parser.service';
import { summarizeFeedForLog } from './av-by-format';
import { INTER_FEED_DELAY_MS, META_FILE, RUN_TIMEOUT_MS, dataFile } from './constants';
import {
  isAvBySnapshotEntry,
  isRemovedAvByListing,
  type AvByFeedResult,
  type AvByListing,
  type AvByPriceChange,
  type AvByResult,
  type AvBySnapshotEntry,
  type RemovedAvByListing,
} from './dto/av-by-listing.dto';

interface AvByMeta {
  lastRunAt?: string;
}

const isAvByMeta = (v: unknown): v is AvByMeta =>
  typeof v === 'object' &&
  v !== null &&
  (!('lastRunAt' in v) || typeof (v as AvByMeta).lastRunAt === 'string');

/**
 * Orchestrates the av.by scrape cycle:
 *   1. Cadence guard — skip if last run was less than minRunIntervalHours ago.
 *   2. For each configured feed:
 *      • Fetch current active listings via ScrapFly.
 *      • Diff against the previous snapshot → new / sold / price-change.
 *      • Persist updated snapshot only for entries that were successfully notified.
 *
 * Notes:
 * - "Sold" = listing disappeared from the active filter. Final price is the
 *   last observed price (av.by doesn't expose actual sale price).
 * - VIN is partial (first 7 chars + asterisks) — av.by gates the full VIN
 *   behind a paid VIN-report service.
 * - Cadence guard is intentional: GitHub Actions fires daily, but ScrapFly's
 *   free tier (1000 credits/mo) doesn't cover 2 feeds × daily × 25 credits.
 *   Default interval = 47h keeps us under budget even with a few retries.
 */
@Injectable()
export class AvByService {
  private readonly logger = new Logger(AvByService.name);
  private isRunning = false;

  constructor(
    private readonly config: ConfigService,
    private readonly snapshot: SnapshotService,
    private readonly notifier: AvByNotifierService,
  ) {}

  async run(): Promise<AvByResult> {
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

  private async scrape(): Promise<AvByResult> {
    const feeds = this.config.get<AvByFeedConfig[]>('avBy.feeds') ?? [];
    const minIntervalHours = this.config.getOrThrow<number>('avBy.minRunIntervalHours');
    const apiKey = this.config.get<string>('avBy.scrapflyApiKey') ?? '';

    if (!apiKey) {
      this.logger.warn('SCRAPFLY_API_KEY not set — skipping av.by scrape');
      return { feeds: [], skipped: true, skipReason: 'no_api_key' };
    }
    if (feeds.length === 0) {
      this.logger.warn('No av.by feeds configured — skipping');
      return { feeds: [], skipped: true, skipReason: 'no_feeds' };
    }

    const meta = await this.readMeta();
    if (meta.lastRunAt) {
      const elapsedHours = (Date.now() - Date.parse(meta.lastRunAt)) / (1000 * 60 * 60);
      if (elapsedHours < minIntervalHours) {
        const wait = (minIntervalHours - elapsedHours).toFixed(1);
        this.logger.log(
          `Skipping — last run ${elapsedHours.toFixed(1)}h ago (min interval ${minIntervalHours}h, wait ${wait}h)`,
        );
        return {
          feeds: [],
          skipped: true,
          skipReason: `cadence_guard:${elapsedHours.toFixed(1)}h_<_${minIntervalHours}h`,
        };
      }
    }

    const parser = new AvByParserService(apiKey);

    const feedResults: AvByFeedResult[] = [];
    const currentByFeed = new Map<string, AvByListing[]>();
    const previousByFeed = new Map<string, Map<number, AvBySnapshotEntry>>();
    const removedByFeed = new Map<string, Map<number, RemovedAvByListing>>();

    for (const [i, feed] of feeds.entries()) {
      if (i > 0) await sleep(INTER_FEED_DELAY_MS);

      const [{ listings: current, total }, previousEntries, previousRemoved] = await Promise.all([
        parser.fetchFeed(feed.url),
        this.snapshot.read(dataFile('all', feed.key), isAvBySnapshotEntry),
        this.snapshot.read(dataFile('removed', feed.key), isRemovedAvByListing),
      ]);

      // Guard against ScrapFly returning 0 results — would falsely mark everything as sold.
      if (current.length === 0 && previousEntries.length > 0) {
        throw new Error(
          `Feed ${feed.key}: parser returned 0 listings but snapshot has ${previousEntries.length} — aborting to prevent data loss`,
        );
      }

      const previousMap = new Map(previousEntries.map(e => [e.id, e]));
      const isBaseline = previousMap.size === 0 && current.length > 0;

      const newListings: AvByListing[] = [];
      const priceChanges: AvByPriceChange[] = [];
      const currentIds = new Set(current.map(c => c.id));

      for (const listing of current) {
        const prev = previousMap.get(listing.id);
        if (!prev) {
          newListings.push(listing);
        } else if (prev.priceUsd !== listing.priceUsd || prev.priceByn !== listing.priceByn) {
          priceChanges.push({
            listing,
            oldPriceUsd: prev.priceUsd,
            oldPriceByn: prev.priceByn,
          });
        }
      }

      const removedMap = new Map<number, RemovedAvByListing>(previousRemoved.map(r => [r.id, r]));
      const now = new Date().toISOString();
      const soldThisRun: RemovedAvByListing[] = [];
      for (const prev of previousMap.values()) {
        if (currentIds.has(prev.id)) continue;
        if (removedMap.has(prev.id)) continue;
        const removed: RemovedAvByListing = {
          ...prev,
          removedAt: now,
          firstSeenAt: prev.firstSeenAt,
        };
        removedMap.set(prev.id, removed);
        soldThisRun.push(removed);
      }

      const result: AvByFeedResult = {
        feedKey: feed.key,
        label: feed.label,
        total,
        newListings,
        soldListings: isBaseline ? [] : soldThisRun,
        priceChanges,
        isBaseline,
      };
      this.logger.log(summarizeFeedForLog(result));

      feedResults.push(result);
      currentByFeed.set(feed.key, current);
      previousByFeed.set(feed.key, previousMap);
      removedByFeed.set(feed.key, removedMap);
    }

    const aggregate: AvByResult = { feeds: feedResults, skipped: false };
    const notifyResult = await this.notifier.notifyRunResult(aggregate);

    for (const feed of feeds) {
      await this.persistSnapshot({
        feed,
        current: currentByFeed.get(feed.key) ?? [],
        previousMap: previousByFeed.get(feed.key) ?? new Map<number, AvBySnapshotEntry>(),
        removedMap: removedByFeed.get(feed.key) ?? new Map<number, RemovedAvByListing>(),
        feedResult: feedResults.find(r => r.feedKey === feed.key)!,
        notifyResult,
      });
    }

    await this.writeMeta({ lastRunAt: new Date().toISOString() });

    return aggregate;
  }

  private async persistSnapshot(opts: {
    feed: AvByFeedConfig;
    current: AvByListing[];
    previousMap: Map<number, AvBySnapshotEntry>;
    removedMap: Map<number, RemovedAvByListing>;
    feedResult: AvByFeedResult;
    notifyResult: AvByNotifyResult;
  }): Promise<void> {
    const { feed, current, previousMap, removedMap, feedResult, notifyResult } = opts;
    const now = new Date().toISOString();

    // Baseline: persist everything unconditionally — no per-listing messages were sent.
    if (feedResult.isBaseline) {
      const seeded = current.map<AvBySnapshotEntry>(l => ({
        ...l,
        firstSeenAt: now,
        lastSeenAt: now,
      }));
      await this.snapshot.write(dataFile('all', feed.key), seeded);
      this.logger.log(`Feed ${feed.key}: baseline saved (${seeded.length} entries)`);
      return;
    }

    const notifiedNew = notifyResult.notifiedNew.get(feed.key) ?? new Set<number>();
    const notifiedSold = notifyResult.notifiedSold.get(feed.key) ?? new Set<number>();
    const notifiedPriceChanges =
      notifyResult.notifiedPriceChanges.get(feed.key) ?? new Set<number>();

    const updated = new Map(previousMap);

    for (const listing of current) {
      const prev = updated.get(listing.id);
      if (!prev) {
        // New listing — persist only if notified, so a Telegram failure means we retry next run.
        if (notifiedNew.has(listing.id)) {
          updated.set(listing.id, { ...listing, firstSeenAt: now, lastSeenAt: now });
        }
        continue;
      }
      const priceChanged = prev.priceUsd !== listing.priceUsd || prev.priceByn !== listing.priceByn;
      if (priceChanged) {
        if (notifiedPriceChanges.has(listing.id)) {
          updated.set(listing.id, {
            ...listing,
            firstSeenAt: prev.firstSeenAt,
            lastSeenAt: now,
          });
        } else {
          // Keep old price in snapshot so the change is detected again next run.
          updated.set(listing.id, { ...prev, lastSeenAt: now });
        }
      } else {
        updated.set(listing.id, { ...prev, lastSeenAt: now });
      }
    }

    // Drop entries that disappeared (they live in the removed file now).
    const currentIds = new Set(current.map(c => c.id));
    for (const id of [...updated.keys()]) {
      if (!currentIds.has(id)) {
        // Only drop from "all" if its removal was successfully notified — otherwise keep it,
        // so we re-detect the disappearance next run.
        if (notifiedSold.has(id)) updated.delete(id);
      }
    }

    // Mark soldNotifiedAt for entries that were sent in this run.
    for (const removed of removedMap.values()) {
      if (notifiedSold.has(removed.id) && !removed.soldNotifiedAt) {
        removed.soldNotifiedAt = now;
      }
    }

    await Promise.all([
      this.snapshot.write(dataFile('all', feed.key), [...updated.values()]),
      this.snapshot.write(dataFile('removed', feed.key), [...removedMap.values()]),
    ]);
    this.logger.log(
      `Feed ${feed.key}: snapshot saved (active=${updated.size}, removed=${removedMap.size})`,
    );
  }

  private async readMeta(): Promise<AvByMeta> {
    try {
      const raw = await fs.readFile(META_FILE, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      return isAvByMeta(parsed) ? parsed : {};
    } catch (err) {
      if (
        err instanceof Error &&
        'code' in err &&
        (err as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return {};
      }
      this.logger.warn(`Failed to read ${META_FILE}, treating as empty`, err);
      return {};
    }
  }

  private async writeMeta(meta: AvByMeta): Promise<void> {
    await fs.mkdir(path.dirname(META_FILE), { recursive: true });
    const tmp = `${META_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(meta, null, 2));
    await fs.rename(tmp, META_FILE);
  }
}
