import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Item, ScraperResult } from './dto/item.dto';
import { DATA_FILES, SPECIAL_KEYWORD } from './constants';
import { ScraperService } from './scraper.service';
import { StorageService } from './storage.service';
import { TelegramService } from './telegram.service';

/**
 * Orchestrates the full scrape cycle:
 *   1. Scrape current listings
 *   2. Compare with previous snapshot to detect new / removed items
 *   3. Notify via Telegram
 *   4. Persist updated snapshots to disk
 *
 * Runs on a configurable cron schedule (SCRAPE_CRON env var).
 * Can also be triggered manually via ScraperController.
 */
@Injectable()
export class ScraperRunnerService {
  private readonly logger = new Logger(ScraperRunnerService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly scraper: ScraperService,
    private readonly storage: StorageService,
    private readonly telegram: TelegramService,
  ) {}

  /** Scheduled entry point — cron expression from config, default: 08:00 every day. */
  @Cron(process.env.SCRAPE_CRON ?? CronExpression.EVERY_DAY_AT_8AM)
  async runScheduled(): Promise<void> {
    this.logger.log('Scheduled scrape started');
    await this.run();
  }

  /** Run one full scrape cycle and return a result summary. */
  async run(): Promise<ScraperResult> {
    const url = this.config.getOrThrow<string>('scraper.scrapeUrl');

    const [currentItems, previousItems] = await Promise.all([
      this.scraper.scrapeItems(url),
      this.storage.read(DATA_FILES.all),
    ]);

    const newItems = currentItems.filter(
      item => !previousItems.some(prev => prev.link === item.link),
    );
    const removedItems = previousItems.filter(
      prev => !currentItems.some(item => item.link === prev.link),
    );
    const specialItems = currentItems.filter(item =>
      item.title?.toLowerCase().includes(SPECIAL_KEYWORD),
    );
    const newSpecialItems = specialItems.filter(
      item => !previousItems.some(prev => prev.link === item.link),
    );

    this.logger.log(
      `Scrape complete — total: ${currentItems.length}, new: ${newItems.length}, ` +
        `removed: ${removedItems.length}, special: ${specialItems.length}`,
    );

    await this.sendNotifications(
      currentItems.length,
      newItems,
      removedItems,
      specialItems,
      newSpecialItems,
    );
    await this.saveSnapshots(currentItems, newItems, removedItems, specialItems);

    return { total: currentItems.length, newItems, removedItems, specialItems, newSpecialItems };
  }

  private async sendNotifications(
    total: number,
    newItems: Item[],
    removedItems: Item[],
    specialItems: Item[],
    newSpecialItems: Item[],
  ): Promise<void> {
    const summary = [
      `<b>📊 Сводка на ${new Date().toLocaleDateString('ru-RU')}</b>`,
      `📋 Всего объявлений: <b>${total}</b>`,
      newItems.length ? `🆕 Новые: <b>${newItems.length}</b>` : '🆕 Новые: 0',
      removedItems.length ? `🗑 Удалённые: <b>${removedItems.length}</b>` : '🗑 Удалённые: 0',
      `🌿 Всего в Заболоть: <b>${specialItems.length}</b>`,
      newSpecialItems.length
        ? `✅ Новые в Заболоть: <b>${newSpecialItems.length}</b>`
        : '✅ Новые в Заболоть: 0',
    ].join('\n');

    await this.telegram.sendMessage(summary);

    if (newItems.length) await this.telegram.sendItemsMessages(newItems, 'Новые:');
    if (removedItems.length) await this.telegram.sendItemsMessages(removedItems, 'Удаленные:');
    if (newSpecialItems.length)
      await this.telegram.sendItemsMessages(newSpecialItems, 'Новые в Заболоть:');
  }

  private async saveSnapshots(
    currentItems: Item[],
    newItems: Item[],
    removedItems: Item[],
    specialItems: Item[],
  ): Promise<void> {
    await Promise.all([
      this.storage.write(DATA_FILES.all, currentItems),
      this.storage.write(DATA_FILES.new, newItems),
      this.storage.write(DATA_FILES.removed, removedItems),
      this.storage.write(DATA_FILES.special, specialItems),
    ]);
  }
}
