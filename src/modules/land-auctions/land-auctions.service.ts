import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { LandAuctionsResult, Listing } from './dto/listing.dto';
import { DATA_FILES, SPECIAL_KEYWORD } from './constants';
import { GcnParserService } from './gcn-parser.service';
import { SnapshotService } from './snapshot.service';
import { TelegramService } from './telegram.service';

/**
 * Orchestrates the full scrape cycle:
 *   1. Fetch current listings from gcn.by
 *   2. Diff against the previous snapshot to detect new / removed listings
 *   3. Notify via Telegram
 *   4. Persist updated snapshots to disk
 *
 * Runs on a configurable cron schedule (SCRAPE_CRON env var, default: 08:00 daily).
 * Can also be triggered manually via LandAuctionsController.
 */
@Injectable()
export class LandAuctionsService {
  private readonly logger = new Logger(LandAuctionsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly parser: GcnParserService,
    private readonly snapshot: SnapshotService,
    private readonly telegram: TelegramService,
  ) {}

  @Cron(process.env.SCRAPE_CRON ?? CronExpression.EVERY_DAY_AT_8AM)
  async runScheduled(): Promise<void> {
    this.logger.log('Scheduled scrape started');
    await this.run();
  }

  /** Run one full scrape cycle and return a result summary. */
  async run(): Promise<LandAuctionsResult> {
    try {
      return await this.scrapeAndNotify();
    } catch (error) {
      // Notify Telegram on critical failure so issues are visible without checking logs
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Critical scrape failure', error);
      await this.telegram.sendMessage(`⚠️ Ошибка скрапинга:\n<code>${message}</code>`);
      throw error;
    }
  }

  private async scrapeAndNotify(): Promise<LandAuctionsResult> {
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

    this.logger.log(
      `Done — total: ${currentListings.length}, new: ${newListings.length}, ` +
        `removed: ${removedListings.length}, special: ${specialListings.length}`,
    );

    await this.notify(
      currentListings.length,
      newListings,
      removedListings,
      specialListings,
      newSpecialListings,
    );
    await this.saveSnapshots(currentListings, newListings, removedListings, specialListings);

    return {
      total: currentListings.length,
      newListings,
      removedListings,
      specialListings,
      newSpecialListings,
    };
  }

  private async notify(
    total: number,
    newListings: Listing[],
    removedListings: Listing[],
    specialListings: Listing[],
    newSpecialListings: Listing[],
  ): Promise<void> {
    const summary = [
      `<b>📊 Сводка на ${new Date().toLocaleDateString('ru-RU')}</b>`,
      `📋 Всего объявлений: <b>${total}</b>`,
      newListings.length ? `🆕 Новые: <b>${newListings.length}</b>` : '🆕 Новые: 0',
      removedListings.length ? `🗑 Удалённые: <b>${removedListings.length}</b>` : '🗑 Удалённые: 0',
      `🌿 Всего в Заболоть: <b>${specialListings.length}</b>`,
      newSpecialListings.length
        ? `✅ Новые в Заболоть: <b>${newSpecialListings.length}</b>`
        : '✅ Новые в Заболоть: 0',
    ].join('\n');

    await this.telegram.sendMessage(summary);

    if (newListings.length) await this.telegram.sendListingMessages(newListings, 'Новые:');
    if (removedListings.length)
      await this.telegram.sendListingMessages(removedListings, 'Удаленные:');
    if (newSpecialListings.length)
      await this.telegram.sendListingMessages(newSpecialListings, 'Новые в Заболоть:');
  }

  private async saveSnapshots(
    currentListings: Listing[],
    newListings: Listing[],
    removedListings: Listing[],
    specialListings: Listing[],
  ): Promise<void> {
    await Promise.all([
      this.snapshot.write(DATA_FILES.all, currentListings),
      this.snapshot.write(DATA_FILES.new, newListings),
      this.snapshot.write(DATA_FILES.removed, removedListings),
      this.snapshot.write(DATA_FILES.special, specialListings),
    ]);
  }
}
