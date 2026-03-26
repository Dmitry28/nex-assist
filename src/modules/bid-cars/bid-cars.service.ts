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
import type { BidCarsResult, CarListing, RemovedCarListing } from './dto/car-listing.dto';
import { DATA_FILES, RUN_TIMEOUT_MS, SOLD_LOOKUP_RETENTION_DAYS } from './constants';
import { BidCarsParserService } from './bid-cars-parser.service';
import { BidCarsNotifierService } from './bid-cars-notifier.service';

// Minimal check: only 'link' presence is verified — sufficient because snapshot files
// are module-specific and will never contain cross-module data.
export const isCarListing = (item: unknown): item is CarListing =>
  typeof item === 'object' &&
  item !== null &&
  'link' in item &&
  typeof (item as { link: unknown }).link === 'string';

export const isRemovedCarListing = (item: unknown): item is RemovedCarListing =>
  isCarListing(item) && typeof (item as unknown as Record<string, unknown>).removedAt === 'string';

/**
 * Business orchestration for the bid.cars scrape cycle:
 *   1. Fetch current active listings
 *   2. Diff against the previous snapshot → detect new / removed listings
 *   3. For removed listings: look up final sold prices from Ended → Archived search pages
 *   4. Send Telegram notifications (removal + sold price if found; follow-up on next run if not)
 *   5. Persist updated snapshots to disk
 *
 * Removed listings accumulate in bid_cars_removed.json for statistics.
 * Sold-price lookups are retried on each run for up to SOLD_LOOKUP_RETENTION_DAYS.
 */
@Injectable()
export class BidCarsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BidCarsService.name);

  // Safe: Node.js is single-threaded — the if-check and flag assignment run
  // atomically (no interleaving possible before the first await).
  private isRunning = false;

  constructor(
    private readonly config: ConfigService,
    private readonly scheduler: SchedulerRegistry,
    private readonly parser: BidCarsParserService,
    private readonly snapshot: SnapshotService,
    private readonly notifier: BidCarsNotifierService,
  ) {}

  onModuleInit(): void {
    const cron = this.config.getOrThrow<string>('bidCars.scrapeCron');
    const job = new CronJob(cron, () => {
      void this.runScheduled();
    });
    this.scheduler.addCronJob('bid-cars-scrape', job);
    job.start();
    this.logger.log(`Cron scheduled: ${cron}`);
  }

  onModuleDestroy(): void {
    this.scheduler.deleteCronJob('bid-cars-scrape');
  }

  async run(): Promise<BidCarsResult> {
    if (this.isRunning) {
      throw new ConflictException('Scrape already in progress');
    }

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
      // notifyError result is intentionally ignored — Telegram failure must not mask the original error
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
      // Error already logged and reported to Telegram inside run()
      this.logger.error('Scheduled scrape failed', error);
    }
  }

  private async scrape(): Promise<BidCarsResult> {
    const scrapeUrl = this.config.getOrThrow<string>('bidCars.scrapeUrl');
    const endedUrl = this.config.get<string>('bidCars.endedUrl') ?? '';
    const archivedUrl = this.config.get<string>('bidCars.archivedUrl') ?? '';

    const [currentListings, previousAll, previousRemoved] = await Promise.all([
      this.parser.fetchListings(scrapeUrl),
      this.snapshot.read(DATA_FILES.all, isCarListing),
      this.snapshot.read(DATA_FILES.removed, isRemovedCarListing),
    ]);

    const newListings = currentListings.filter(c => !previousAll.some(p => p.link === c.link));
    const newlyRemovedLinks = new Set(
      previousAll.filter(p => !currentListings.some(c => c.link === p.link)).map(p => p.link),
    );

    const now = new Date().toISOString();
    const cutoff = new Date(
      Date.now() - SOLD_LOOKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    // Build map of all tracked removed listings.
    // Entries without removedAt are legacy (pre-feature) — treat as ancient so they are
    // excluded from pending lookups but kept for statistics if soldNotifiedAt is set.
    const removedMap = new Map<string, RemovedCarListing>(
      previousRemoved.map(r => [
        r.link,
        r.removedAt ? r : { ...r, removedAt: '1970-01-01T00:00:00.000Z' },
      ]),
    );

    // Register newly removed listings not already tracked
    for (const listing of previousAll.filter(p => newlyRemovedLinks.has(p.link))) {
      if (!removedMap.has(listing.link)) {
        removedMap.set(listing.link, { ...listing, removedAt: now });
      }
    }

    // Pending: not yet sold-notified and within the retention window
    const pending = [...removedMap.values()].filter(
      r => !r.soldNotifiedAt && r.removedAt >= cutoff,
    );

    if (pending.length > 0 && endedUrl) {
      await this.enrichWithSoldPrices(pending, endedUrl, archivedUrl);
    }

    // Listings to notify about this run:
    // 1. Newly removed (first appearance) — include sold price if already found
    const toNotifyRemoval = pending.filter(
      r => !r.removalNotifiedAt && newlyRemovedLinks.has(r.link),
    );
    // 2. Previously removed listings where sold price was just found
    const toNotifySold = pending.filter(
      r => r.soldPrice && !r.soldNotifiedAt && r.removalNotifiedAt,
    );

    this.logger.log(
      `Done — total: ${currentListings.length}, new: ${newListings.length}, ` +
        `removed: ${newlyRemovedLinks.size}, sold prices found: ${pending.filter(r => r.soldPrice).length}, ` +
        `sold price updates: ${toNotifySold.length}`,
    );

    const result: BidCarsResult = {
      total: currentListings.length,
      newListings,
      removedListings: toNotifyRemoval,
      soldPriceUpdates: toNotifySold,
    };

    // Notify first, then always persist — even if Telegram is down.
    // Unlike KufarService (which delays persist until notification succeeds),
    // bid.cars returns a full current snapshot each run, so we can always
    // reconstruct the diff on the next run without losing listings.
    await this.notifier.notifyRunResult(result);

    // Mark notifications sent after successful delivery
    for (const r of toNotifyRemoval) {
      r.removalNotifiedAt = now;
      if (r.soldPrice) r.soldNotifiedAt = now;
    }
    for (const r of toNotifySold) {
      r.soldNotifiedAt = now;
    }

    // Keep: pending (within retention) + settled entries (soldNotifiedAt set, for statistics)
    const finalRemoved = [...removedMap.values()].filter(
      r => r.soldNotifiedAt || r.removedAt >= cutoff,
    );

    await Promise.all([
      this.snapshot.write(DATA_FILES.all, currentListings),
      this.snapshot.write(DATA_FILES.new, newListings),
      this.snapshot.write(DATA_FILES.removed, finalRemoved),
    ]);
    this.logger.log('Snapshots saved');

    return result;
  }

  /** Enrich pending removed listings with sold prices: try Ended first, then Archived. */
  private async enrichWithSoldPrices(
    pending: RemovedCarListing[],
    endedUrl: string,
    archivedUrl: string,
  ): Promise<void> {
    const stillMissing = await this.lookupSoldPrices(pending, endedUrl);
    if (stillMissing.length > 0 && archivedUrl) {
      await this.lookupSoldPrices(stillMissing, archivedUrl);
    }
  }

  /**
   * Fetch listings from a URL and match by VIN to fill in soldPrice.
   * Returns the subset of pending listings where no price was found.
   */
  private async lookupSoldPrices(
    pending: RemovedCarListing[],
    url: string,
  ): Promise<RemovedCarListing[]> {
    let endedListings: CarListing[];
    try {
      this.logger.log(`Looking up sold prices from ${url}`);
      endedListings = await this.parser.fetchListings(url);
    } catch (err) {
      this.logger.warn(`Failed to fetch sold price listings from ${url}`, err);
      return pending;
    }

    const vinMap = new Map(endedListings.filter(l => l.vin).map(l => [l.vin!, l]));

    const stillMissing: RemovedCarListing[] = [];
    for (const listing of pending) {
      const ended = listing.vin ? vinMap.get(listing.vin) : undefined;
      if (ended?.currentBid) {
        listing.soldPrice = ended.currentBid;
        this.logger.log(`Sold price for ${listing.vin ?? listing.lot}: ${listing.soldPrice}`);
      } else {
        stillMissing.push(listing);
      }
    }

    return stillMissing;
  }
}
