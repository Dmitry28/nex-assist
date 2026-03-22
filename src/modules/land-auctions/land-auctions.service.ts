import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { LandAuctionsResult } from './dto/listing.dto';
import { DATA_FILES, SPECIAL_KEYWORD } from './constants';
import { GcnParserService } from './gcn-parser.service';
import { ListingNotifierService } from './listing-notifier.service';
import { SnapshotService } from './snapshot.service';

/**
 * Business orchestration for the land auctions scrape cycle:
 *   1. Fetch current listings from gcn.by
 *   2. Diff against the previous snapshot → detect new / removed listings
 *   3. Send Telegram notifications
 *   4. Persist updated snapshots to disk
 */
@Injectable()
export class LandAuctionsService {
  private readonly logger = new Logger(LandAuctionsService.name);
  /** Prevents concurrent runs (e.g. cron fires while a manual run is in progress). */
  private isRunning = false;

  constructor(
    private readonly config: ConfigService,
    private readonly parser: GcnParserService,
    private readonly snapshot: SnapshotService,
    private readonly notifier: ListingNotifierService,
  ) {}

  @Cron(process.env.SCRAPE_CRON ?? CronExpression.EVERY_DAY_AT_8AM)
  async runScheduled(): Promise<void> {
    this.logger.log('Scheduled scrape started');
    await this.run();
  }

  async run(): Promise<LandAuctionsResult> {
    if (this.isRunning) {
      this.logger.warn('Scrape already in progress, skipping');
      throw new Error('Scrape already in progress');
    }

    this.isRunning = true;
    try {
      return await this.scrape();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Critical scrape failure', error);
      await this.notifier.notifyError(message);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  private async scrape(): Promise<LandAuctionsResult> {
    const url = this.config.getOrThrow<string>('landAuctions.scrapeUrl');

    const [currentListings, previousListings] = await Promise.all([
      this.parser.fetchListings(url),
      this.snapshot.read(DATA_FILES.all),
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
