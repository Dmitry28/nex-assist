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
import type { KufarFeedConfig } from '../../config/kufar.config';
import type {
  KufarFeedResult,
  KufarListing,
  KufarPriceChange,
  KufarResult,
  KufarSnapshotEntry,
} from './dto/kufar-listing.dto';
import { dataFile } from './constants';
import { KufarParserService } from './kufar-parser.service';
import { KufarNotifierService } from './kufar-notifier.service';

const isKufarSnapshotEntry = (item: unknown): item is KufarSnapshotEntry =>
  typeof item === 'object' &&
  item !== null &&
  'adId' in item &&
  typeof (item as { adId: unknown }).adId === 'number' &&
  'listTime' in item &&
  typeof (item as { listTime: unknown }).listTime === 'string';

/**
 * Orchestrates the Kufar scrape cycle for all configured feeds:
 *   1. Fetch recent listings (today/yesterday) from each search URL
 *   2. Diff against the per-feed snapshot → detect new listings and price changes
 *   3. Send Telegram notifications
 *   4. Persist updated snapshots to disk
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

    const feedResults: KufarFeedResult[] = [];

    for (const feed of feeds) {
      const result = await this.scrapeFeed(feed);
      feedResults.push(result);
    }

    // Send combined Telegram summary + per-listing messages
    await this.notifier.notifyRunResult({ feeds: feedResults });

    // Persist snapshots only after successful notification
    for (const feed of feeds) {
      const result = feedResults.find(r => r.feedName === feed.key);
      if (result) {
        await this.persistSnapshot(feed.key, result);
      }
    }

    return { feeds: feedResults };
  }

  private async scrapeFeed(feed: KufarFeedConfig): Promise<KufarFeedResult> {
    this.logger.log(`Fetching feed: ${feed.key}`);

    const [currentListings, previousEntries] = await Promise.all([
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
      } else if (prev.priceByn !== listing.priceByn) {
        priceChanges.push({ listing, oldPriceByn: prev.priceByn, oldPriceUsd: prev.priceUsd });
      }
      // Same price → bumped ad, silently ignore
    }

    // Build updated snapshot (upsert: add new, update existing)
    const now = new Date().toISOString();
    const updatedMap = new Map(previousMap);

    for (const listing of currentListings) {
      const prev = updatedMap.get(listing.adId);
      const entry: KufarSnapshotEntry = {
        ...listing,
        firstSeenAt: prev?.firstSeenAt ?? now,
        lastSeenAt: now,
      };
      updatedMap.set(listing.adId, entry);
    }

    const total = updatedMap.size;

    this.logger.log(
      `Feed ${feed.key} — total in snapshot: ${total}, new: ${newListings.length}, price changes: ${priceChanges.length}`,
    );

    // Store the updated entries back; we'll write to disk after notification succeeds
    // We pass this via the result object so persistSnapshot can access it.
    // Using a small trick: attach updatedEntries to the result under a private symbol.
    const result: KufarFeedResult & { _updatedEntries?: KufarSnapshotEntry[] } = {
      feedName: feed.key,
      total,
      newListings,
      priceChanges,
      _updatedEntries: [...updatedMap.values()],
    };

    return result;
  }

  private async persistSnapshot(feedKey: string, result: KufarFeedResult): Promise<void> {
    const entries = (result as KufarFeedResult & { _updatedEntries?: KufarSnapshotEntry[] })
      ._updatedEntries;
    if (!entries) return;
    await this.snapshot.write(dataFile(feedKey), entries);
  }
}
