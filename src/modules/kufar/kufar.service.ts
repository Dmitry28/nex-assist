import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { SnapshotService } from '../../common/snapshot.service';
import { sleep } from '../../common/utils/sleep';
import type { KufarFeedConfig } from '../../config/kufar.config';
import type {
  KufarFeedResult,
  KufarListing,
  KufarPriceChange,
  KufarResult,
  KufarSnapshotEntry,
} from './dto/kufar-listing.dto';
import { INTER_FEED_DELAY_MS, dataFile, RUN_TIMEOUT_MS } from './constants';
import { KufarParserService } from './kufar-parser.service';
import { KufarNotifierService, KufarNotifyResult } from './kufar-notifier.service';

/** Treat 0 and undefined as equivalent "no price" to avoid false price-change detections. */
const effectivePrice = (p: number | undefined): number | undefined =>
  p !== undefined && p > 0 ? p : undefined;

/** Single source of truth for price-change detection — used in both scrapeFeed and persistSnapshot. */
const hasPriceChanged = (prev: KufarSnapshotEntry, current: KufarListing): boolean =>
  effectivePrice(prev.priceByn) !== effectivePrice(current.priceByn);

const isKufarSnapshotEntry = (item: unknown): item is KufarSnapshotEntry =>
  typeof item === 'object' &&
  item !== null &&
  'adId' in item &&
  typeof (item as { adId: unknown }).adId === 'number' &&
  'listTime' in item &&
  typeof (item as { listTime: unknown }).listTime === 'string';

/** Internal data kept per feed during a scrape cycle — not exposed to callers. */
interface KufarFeedScrapeData {
  feed: KufarFeedConfig;
  currentListings: KufarListing[];
  previousMap: Map<number, KufarSnapshotEntry>;
  result: KufarFeedResult;
}

/**
 * Orchestrates the Kufar scrape cycle for all configured feeds:
 *   1. Fetch recent listings (today/yesterday) from each search URL
 *   2. Diff against the per-feed snapshot → detect new listings and price changes
 *   3. Send Telegram notifications — only what was successfully sent gets persisted
 *   4. Persist updated snapshots to disk (bumped ads always saved; new/price-change only if notified)
 *
 * Bumped ads (reappearing with the same price) are silently ignored.
 */
@Injectable()
export class KufarService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KufarService.name);
  private isRunning = false;

  constructor(
    private readonly config: ConfigService,
    private readonly scheduler: SchedulerRegistry,
    private readonly parser: KufarParserService,
    private readonly snapshot: SnapshotService,
    private readonly notifier: KufarNotifierService,
  ) {}

  onModuleInit(): void {
    const cron = this.config.getOrThrow<string>('kufar.scrapeCron');
    const job = new CronJob(cron, () => {
      void this.runScheduled();
    });
    this.scheduler.addCronJob('kufar-scrape', job);
    job.start();
    this.logger.log(`Cron scheduled: ${cron}`);
  }

  onModuleDestroy(): void {
    this.scheduler.deleteCronJob('kufar-scrape');
  }

  async run(): Promise<KufarResult> {
    if (this.isRunning) throw new ConflictException('Scrape already in progress');

    this.isRunning = true;

    // Watchdog: if the scrape hangs longer than RUN_TIMEOUT_MS, reset the lock
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

  private async runScheduled(): Promise<void> {
    try {
      this.logger.log('Scheduled scrape started');
      await this.run();
    } catch (error) {
      if (error instanceof ConflictException) {
        this.logger.warn('Scheduled scrape skipped — manual run already in progress');
        return;
      }
      this.logger.error('Scheduled scrape failed', error);
    }
  }

  private async scrape(): Promise<KufarResult> {
    const feeds = this.config.get<KufarFeedConfig[]>('kufar.feeds') ?? [];

    if (feeds.length === 0) {
      this.logger.warn('No Kufar feeds configured — skipping');
      return { feeds: [] };
    }

    const scrapeData: KufarFeedScrapeData[] = [];

    for (const [i, feed] of feeds.entries()) {
      if (i > 0) await sleep(INTER_FEED_DELAY_MS);
      scrapeData.push(await this.scrapeFeed(feed));
    }

    // Notify and track which adIds were actually delivered
    const notifyResult = await this.notifier.notifyRunResult({
      feeds: scrapeData.map(d => d.result),
    });

    // Persist: new/price-change entries only if notified; bumped entries always
    for (const data of scrapeData) {
      await this.persistSnapshot(data, notifyResult);
    }

    return { feeds: scrapeData.map(d => d.result) };
  }

  private async scrapeFeed(feed: KufarFeedConfig): Promise<KufarFeedScrapeData> {
    this.logger.log(`Fetching feed: ${feed.key}`);

    const [{ listings: currentListings, truncated }, previousEntries] = await Promise.all([
      this.parser.fetchFeed(feed.url),
      this.snapshot.read(dataFile(feed.key), isKufarSnapshotEntry),
    ]);

    const previousMap = new Map(previousEntries.map(e => [e.adId, e]));

    const newListings: KufarListing[] = [];
    const priceChanges: KufarPriceChange[] = [];

    for (const listing of currentListings) {
      const prev = previousMap.get(listing.adId);

      if (!prev) {
        newListings.push(listing);
      } else if (hasPriceChanged(prev, listing)) {
        priceChanges.push({ listing, oldPriceByn: prev.priceByn, oldPriceUsd: prev.priceUsd });
      }
      // Same effective price → bumped ad, silently ignore
    }

    // Total is an estimate: previous + newly seen. Actual persisted count may be lower
    // if notifications fail (new listings won't be saved until next successful delivery).
    const total = previousMap.size + newListings.length;

    this.logger.log(
      `Feed ${feed.key} — snapshot estimate: ${total}, new: ${newListings.length}, price changes: ${priceChanges.length}${truncated ? ' [TRUNCATED]' : ''}`,
    );

    return {
      feed,
      currentListings,
      previousMap,
      result: { feedName: feed.key, total, newListings, priceChanges, truncated },
    };
  }

  private async persistSnapshot(
    data: KufarFeedScrapeData,
    notifyResult: KufarNotifyResult,
  ): Promise<void> {
    const { feed, currentListings, previousMap, result } = data;
    const notifiedNew = notifyResult.notifiedNew.get(feed.key) ?? new Set<number>();
    const notifiedPriceChanges =
      notifyResult.notifiedPriceChanges.get(feed.key) ?? new Set<number>();

    const now = new Date().toISOString();
    const updatedMap = new Map(previousMap);

    for (const listing of currentListings) {
      const prev = updatedMap.get(listing.adId);
      const isNew = !prev;
      const isPriceChange = prev !== undefined && hasPriceChanged(prev, listing);

      if (isNew) {
        // Only persist if notification was delivered — otherwise retry next run
        if (notifiedNew.has(listing.adId)) {
          updatedMap.set(listing.adId, { ...listing, firstSeenAt: now, lastSeenAt: now });
        }
      } else if (isPriceChange) {
        if (notifiedPriceChanges.has(listing.adId)) {
          // Update to new price only after successful notification
          updatedMap.set(listing.adId, {
            ...listing,
            firstSeenAt: prev.firstSeenAt,
            lastSeenAt: now,
          });
        } else {
          // Keep old price — will retry next run; still refresh lastSeenAt
          updatedMap.set(listing.adId, { ...prev, lastSeenAt: now });
        }
      } else {
        // Bumped (same price) — always update lastSeenAt
        updatedMap.set(listing.adId, { ...prev, lastSeenAt: now });
      }
    }

    // Log if nothing was persisted due to notification failures
    const notifiedCount = notifiedNew.size + notifiedPriceChanges.size;
    const pendingCount = Math.max(
      0,
      result.newListings.length + result.priceChanges.length - notifiedCount,
    );
    if (pendingCount > 0) {
      this.logger.warn(
        `Feed ${feed.key}: ${pendingCount} listing(s) not persisted — notification failed, will retry next run`,
      );
    }

    await this.snapshot.write(dataFile(feed.key), [...updatedMap.values()]);
  }
}
