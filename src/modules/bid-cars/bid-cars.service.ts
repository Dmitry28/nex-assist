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
import type { BidCarsResult, CarListing } from './dto/car-listing.dto';
import { DATA_FILES } from './constants';
import { BidCarsParserService } from './bid-cars-parser.service';
import { BidCarsNotifierService } from './bid-cars-notifier.service';

// Minimal check: only 'link' presence is verified — sufficient because snapshot files
// are module-specific and will never contain cross-module data.
const isCarListing = (item: unknown): item is CarListing =>
  typeof item === 'object' && item !== null && 'link' in item;

/**
 * Business orchestration for the bid.cars scrape cycle:
 *   1. Fetch current listings from bid.cars
 *   2. Diff against the previous snapshot → detect new / removed listings
 *   3. Send Telegram notifications
 *   4. Persist updated snapshots to disk
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
    const url = this.config.getOrThrow<string>('bidCars.scrapeUrl');

    const [currentListings, previousListings] = await Promise.all([
      this.parser.fetchListings(url),
      this.snapshot.read(DATA_FILES.all, isCarListing),
    ]);

    const newListings = currentListings.filter(
      l => !previousListings.some(prev => prev.link === l.link),
    );
    const removedListings = previousListings.filter(
      prev => !currentListings.some(l => l.link === prev.link),
    );

    const result: BidCarsResult = {
      total: currentListings.length,
      newListings,
      removedListings,
    };

    this.logger.log(
      `Done — total: ${result.total}, new: ${newListings.length}, removed: ${removedListings.length}`,
    );

    // Notify first — if Telegram is down the snapshot must NOT be updated
    await this.notifier.notifyRunResult(result);

    await Promise.all([
      this.snapshot.write(DATA_FILES.all, currentListings),
      this.snapshot.write(DATA_FILES.new, newListings),
      this.snapshot.write(DATA_FILES.removed, removedListings),
    ]);

    return result;
  }
}
