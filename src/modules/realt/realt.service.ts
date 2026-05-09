import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { SnapshotService } from '../../common/snapshot.service';
import { sleep } from '../../common/utils/sleep';
import type { RealtFeedConfig } from '../../config/realt.config';
import { INTER_FEED_DELAY_MS, RUN_TIMEOUT_MS, dataFile } from './constants';
import { isRealtSnapshotEntry } from './dto/realt-listing.dto';
import type {
  RealtFeedResult,
  RealtListing,
  RealtPriceChange,
  RealtResult,
  RealtSnapshotEntry,
} from './dto/realt-listing.dto';
import { RealtNotifierService, RealtNotifyResult } from './realt-notifier.service';
import { RealtParserService } from './realt-parser.service';

/** Treat 0 and undefined as equivalent "no price" to avoid false price-change detections. */
export const effectivePrice = (p: number | undefined): number | undefined =>
  p !== undefined && p > 0 ? p : undefined;

/**
 * Single source of truth for price-change detection — used in both scrapeFeed and persistSnapshot.
 * Both BYN and USD must change: if either is stable, the seller didn't change the price
 * (the other just fluctuated with the exchange rate).
 */
export const hasPriceChanged = (prev: RealtSnapshotEntry, current: RealtListing): boolean =>
  effectivePrice(prev.priceByn) !== effectivePrice(current.priceByn) &&
  effectivePrice(prev.priceUsd) !== effectivePrice(current.priceUsd);

/** Internal data kept per feed during a scrape cycle — not exposed to callers. */
interface RealtFeedScrapeData {
  feed: RealtFeedConfig;
  currentListings: RealtListing[];
  previousMap: Map<number, RealtSnapshotEntry>;
  result: RealtFeedResult;
}

/**
 * Orchestrates the realt.by scrape cycle for all configured feeds:
 *   1. Fetch listings from each search URL (paginated, no time window — full result set)
 *   2. Diff against the per-feed snapshot → detect new listings and price changes
 *   3. Send Telegram notifications — only what was successfully sent gets persisted
 *   4. Persist updated snapshots to disk (re-seen ads always saved; new/price-change only if notified)
 *
 * Re-seen ads (same price) are silently ignored.
 */
@Injectable()
export class RealtService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtService.name);
  private isRunning = false;

  constructor(
    private readonly config: ConfigService,
    private readonly scheduler: SchedulerRegistry,
    private readonly parser: RealtParserService,
    private readonly snapshot: SnapshotService,
    private readonly notifier: RealtNotifierService,
  ) {}

  onModuleInit(): void {
    // Cron disabled — see kufar.service.ts: in GitHub Actions cron fired mid-run and caused duplicates.
    // Trigger via HTTP POST /api/v1/realt/run instead.
  }

  onModuleDestroy(): void {
    if (!this.scheduler.doesExist('cron', 'realt-scrape')) return;
    this.scheduler.deleteCronJob('realt-scrape');
  }

  async run(): Promise<RealtResult> {
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

  private async scrape(): Promise<RealtResult> {
    const feeds = this.config.get<RealtFeedConfig[]>('realt.feeds') ?? [];

    if (feeds.length === 0) {
      this.logger.warn('No realt.by feeds configured — skipping');
      return { feeds: [] };
    }

    const scrapeData: RealtFeedScrapeData[] = [];

    for (const [i, feed] of feeds.entries()) {
      if (i > 0) await sleep(INTER_FEED_DELAY_MS);
      scrapeData.push(await this.scrapeFeed(feed));
    }

    const notifyResult = await this.notifier.notifyRunResult({
      feeds: scrapeData.map(d => d.result),
    });

    for (const data of scrapeData) {
      await this.persistSnapshot(data, notifyResult);
    }

    const totalNew = scrapeData.reduce((sum, d) => sum + d.result.newListings.length, 0);
    const totalChanges = scrapeData.reduce((sum, d) => sum + d.result.priceChanges.length, 0);
    this.logger.log(
      `Done — feeds: ${feeds.length}, new: ${totalNew}, price changes: ${totalChanges}`,
    );

    return { feeds: scrapeData.map(d => d.result) };
  }

  private async scrapeFeed(feed: RealtFeedConfig): Promise<RealtFeedScrapeData> {
    this.logger.log(`Fetching feed: ${feed.key}`);

    const [{ listings: currentListings, truncated }, previousEntries] = await Promise.all([
      this.parser.fetchFeed(feed.url, feed.linkPath),
      this.snapshot.read(dataFile(feed.key), isRealtSnapshotEntry),
    ]);

    const previousMap = new Map(previousEntries.map(e => [e.adId, e]));
    const isBaseline = previousMap.size === 0 && currentListings.length > 0;

    const newListings: RealtListing[] = [];
    const priceChanges: RealtPriceChange[] = [];

    for (const listing of currentListings) {
      const prev = previousMap.get(listing.adId);

      if (!prev) {
        newListings.push(listing);
      } else if (hasPriceChanged(prev, listing)) {
        priceChanges.push({ listing, oldPriceByn: prev.priceByn, oldPriceUsd: prev.priceUsd });
      }
      // Same effective price → re-seen ad, silently ignore
    }

    const total = previousMap.size + newListings.length;

    this.logger.log(
      `Feed ${feed.key} — snapshot estimate: ${total}, new: ${newListings.length}, price changes: ${priceChanges.length}${truncated ? ' [TRUNCATED]' : ''}${isBaseline ? ' [BASELINE]' : ''}`,
    );

    return {
      feed,
      currentListings,
      previousMap,
      result: { feedName: feed.key, total, newListings, priceChanges, truncated, isBaseline },
    };
  }

  private async persistSnapshot(
    data: RealtFeedScrapeData,
    notifyResult: RealtNotifyResult,
  ): Promise<void> {
    const { feed, currentListings, previousMap, result } = data;
    const notifiedNew = notifyResult.notifiedNew.get(feed.key) ?? new Set<number>();
    const notifiedPriceChanges =
      notifyResult.notifiedPriceChanges.get(feed.key) ?? new Set<number>();

    const now = new Date().toISOString();
    const updatedMap = new Map(previousMap);

    // Silent baseline: snapshot was empty, persist all listings unconditionally
    // (no notification gating — nothing was sent per-listing) and skip the loop below.
    if (result.isBaseline) {
      for (const listing of currentListings) {
        updatedMap.set(listing.adId, { ...listing, firstSeenAt: now, lastSeenAt: now });
      }
      await this.snapshot.write(dataFile(feed.key), [...updatedMap.values()]);
      this.logger.log(
        `Feed ${feed.key}: baseline saved (${updatedMap.size} entries, no per-listing messages sent)`,
      );
      return;
    }

    for (const listing of currentListings) {
      const prev = updatedMap.get(listing.adId);
      const isNew = !prev;
      const isPriceChange = prev !== undefined && hasPriceChanged(prev, listing);

      if (isNew) {
        if (notifiedNew.has(listing.adId)) {
          updatedMap.set(listing.adId, { ...listing, firstSeenAt: now, lastSeenAt: now });
        }
      } else if (isPriceChange) {
        if (notifiedPriceChanges.has(listing.adId)) {
          updatedMap.set(listing.adId, {
            ...listing,
            firstSeenAt: prev.firstSeenAt,
            lastSeenAt: now,
          });
        } else {
          updatedMap.set(listing.adId, { ...prev, lastSeenAt: now });
        }
      } else {
        updatedMap.set(listing.adId, { ...prev, lastSeenAt: now });
      }
    }

    const pendingCount =
      result.newListings.filter(l => !notifiedNew.has(l.adId)).length +
      result.priceChanges.filter(c => !notifiedPriceChanges.has(c.listing.adId)).length;
    if (pendingCount > 0) {
      this.logger.warn(
        `Feed ${feed.key}: ${pendingCount} listing(s) not persisted — notification failed, will retry next run`,
      );
    }

    await this.snapshot.write(dataFile(feed.key), [...updatedMap.values()]);
    this.logger.log(`Feed ${feed.key}: snapshot saved (${updatedMap.size} entries)`);
  }
}
