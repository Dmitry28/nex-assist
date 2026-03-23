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
import type { LandAuctionsResult, Listing } from './dto/listing.dto';
import { DATA_FILES, RUN_TIMEOUT_MS, SPECIAL_KEYWORD } from './constants';
import { GcnParserService } from './gcn-parser.service';
import { ListingNotifierService } from './listing-notifier.service';

const isListing = (item: unknown): item is Listing =>
  typeof item === 'object' &&
  item !== null &&
  'link' in item &&
  typeof (item as { link: unknown }).link === 'string';

/**
 * Business orchestration for the land auctions scrape cycle:
 *   1. Fetch current listings from gcn.by
 *   2. Diff against the previous snapshot → detect new / removed listings
 *   3. Persist updated snapshots to disk
 *   4. Send Telegram notifications
 *
 * The cron schedule is read from config at runtime (SCRAPE_CRON env var),
 * which is why we use dynamic scheduling via SchedulerRegistry instead of
 * the @Cron decorator (decorators are evaluated before ConfigModule loads).
 */
@Injectable()
export class LandAuctionsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LandAuctionsService.name);

  // Safe: Node.js is single-threaded — the if-check and flag assignment run
  // atomically (no interleaving possible before the first await).
  private isRunning = false;

  constructor(
    private readonly config: ConfigService,
    private readonly scheduler: SchedulerRegistry,
    private readonly parser: GcnParserService,
    private readonly snapshot: SnapshotService,
    private readonly notifier: ListingNotifierService,
  ) {}

  onModuleInit(): void {
    const cron = this.config.getOrThrow<string>('landAuctions.scrapeCron');
    const job = new CronJob(cron, () => {
      void this.runScheduled();
    });
    this.scheduler.addCronJob('land-auctions-scrape', job);
    job.start();
    this.logger.log(`Cron scheduled: ${cron}`);
  }

  onModuleDestroy(): void {
    this.scheduler.deleteCronJob('land-auctions-scrape');
  }

  async run(): Promise<LandAuctionsResult> {
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
      // notifyError result is intentionally ignored — Telegram failure here must not mask the original error
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
      // Error already logged and reported to Telegram inside run() — just prevent unhandled rejection
      this.logger.error('Scheduled scrape failed', error);
    }
  }

  private async scrape(): Promise<LandAuctionsResult> {
    const url = this.config.getOrThrow<string>('landAuctions.scrapeUrl');

    const [currentListings, previousListings] = await Promise.all([
      this.parser.fetchListings(url),
      this.snapshot.read(DATA_FILES.all, isListing),
    ]);

    const newListings = currentListings.filter(
      l => !previousListings.some(prev => prev.link === l.link),
    );
    const removedListings = previousListings.filter(
      prev => !currentListings.some(l => l.link === prev.link),
    );
    const specialListings = currentListings.filter(l =>
      l.title?.toLowerCase().includes(SPECIAL_KEYWORD),
    );
    const newSpecialListings = specialListings.filter(
      l => !previousListings.some(prev => prev.link === l.link),
    );

    const result: LandAuctionsResult = {
      total: currentListings.length,
      newListings,
      removedListings,
      specialListings,
      newSpecialListings,
    };

    this.logger.log(
      `Done — total: ${result.total}, new: ${newListings.length}, ` +
        `removed: ${removedListings.length}, special: ${specialListings.length}`,
    );

    // Notify first — if Telegram is down the snapshot must NOT be updated, so items remain
    // "new" and will be retried on the next run. Missing a notification is a critical failure.
    await this.notifier.notifyRunResult(result);

    await Promise.all([
      this.snapshot.write(DATA_FILES.all, currentListings),
      this.snapshot.write(DATA_FILES.new, newListings),
      this.snapshot.write(DATA_FILES.removed, removedListings),
      this.snapshot.write(DATA_FILES.special, specialListings),
    ]);

    return result;
  }
}
