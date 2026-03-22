import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sleep } from '../../common/utils/sleep';
import { TelegramService } from '../telegram/telegram.service';
import type { BidCarsResult, CarListing } from './dto/car-listing.dto';
import {
  EMPTY_VALUES,
  NOTIFICATION_HEADERS,
  TELEGRAM_CAPTION_LIMIT,
  TELEGRAM_SEND_DELAY_MS,
} from './constants';

/**
 * Sends bid.cars notifications via Telegram.
 * Formats captions and delegates sending to the shared TelegramService.
 */
@Injectable()
export class BidCarsNotifierService {
  private readonly logger = new Logger(BidCarsNotifierService.name);
  private readonly chatId: string;

  constructor(
    private readonly telegram: TelegramService,
    config: ConfigService,
  ) {
    this.chatId = config.get<string>('bidCars.chatId') ?? '';
  }

  /**
   * Send the run summary and per-listing messages for new/removed listings.
   * Throws if the summary fails — caller must not persist snapshot in that case.
   */
  async notifyRunResult(result: BidCarsResult): Promise<void> {
    if (!this.chatId) {
      this.logger.warn('chatId not set — skipping Telegram notification');
      return;
    }
    const { total, newListings, removedListings } = result;

    const ok = await this.telegram.sendMessage(
      this.chatId,
      buildSummary({
        date: new Date(),
        total,
        newCount: newListings.length,
        removedCount: removedListings.length,
      }),
    );

    if (!ok) throw new Error('Не удалось отправить сводку в Telegram');

    if (newListings.length) await this.sendListings(newListings, NOTIFICATION_HEADERS.new);
    if (removedListings.length)
      await this.sendListings(removedListings, NOTIFICATION_HEADERS.removed);
  }

  async notifyError(message: string): Promise<void> {
    if (!this.chatId) return;
    const ok = await this.telegram.sendMessage(
      this.chatId,
      `⚠️ Ошибка скрапинга:\n<code>${message}</code>`,
    );
    if (!ok) this.logger.warn('Failed to send error notification to Telegram');
  }

  private async sendListings(listings: CarListing[], header: string): Promise<void> {
    const failed: CarListing[] = [];

    for (const [i, listing] of listings.entries()) {
      const ok = await this.sendListing({ listing, header, index: i + 1, total: listings.length });
      if (!ok) failed.push(listing);
      if (i < listings.length - 1) await sleep(TELEGRAM_SEND_DELAY_MS);
    }

    if (failed.length > 0) {
      const list = failed.map(l => `• ${l.title ?? l.link}`).join('\n');
      await this.telegram.sendMessage(
        this.chatId,
        `⚠️ Не удалось отправить ${failed.length} объект(а):\n${list}`,
      );
    }
  }

  private async sendListing({
    listing,
    header,
    index,
    total,
  }: SendListingParams): Promise<boolean> {
    const caption = truncateCaption(buildCaption({ listing, header, index, total }));
    // bid.cars CDN blocks Telegram from fetching images, so text-only messages are used.
    return this.telegram.sendMessage(this.chatId, caption);
  }
}

// ─── Domain formatting helpers ────────────────────────────────────────────────

interface SendListingParams {
  listing: CarListing;
  header: string;
  index: number;
  total: number;
}

interface SummaryParams {
  date: Date;
  total: number;
  newCount: number;
  removedCount: number;
}

const hasValue = (val: string | undefined): val is string => !!val && !EMPTY_VALUES.has(val);

const buildSummary = ({ date, total, newCount, removedCount }: SummaryParams): string =>
  [
    `<b>🚗 Сводка на ${date.toLocaleDateString('ru-RU')}</b>`,
    `📋 Всего лотов: <b>${total}</b>`,
    `🆕 Новые: <b>${newCount}</b>`,
    `🗑 Снятые: <b>${removedCount}</b>`,
  ].join('\n');

const buildCaption = ({ listing, header, index, total }: SendListingParams): string => {
  const lines: string[] = [
    `<b>${header} · ${index}/${total}</b>`,
    '',
    `🚗 <b>${listing.title ?? 'Без названия'}</b>`,
  ];

  // Prices — most important, shown first
  if (hasValue(listing.currentBid)) lines.push('', `💰 Ставка: ${listing.currentBid}`);
  if (hasValue(listing.buyNow)) lines.push(`⚡ BIN: ${listing.buyNow}`);

  // Damage + running condition + document type
  if (hasValue(listing.damage)) lines.push('', `💥 ${listing.damage}`);
  if (hasValue(listing.condition)) lines.push(`🚦 ${listing.condition}`);
  if (hasValue(listing.keys)) lines.push(`📄 ${listing.keys}`);

  // Odometer + engine + location + date
  if (hasValue(listing.odometer)) lines.push('', `📏 ${listing.odometer}`);
  if (hasValue(listing.engine)) lines.push(`🔧 ${listing.engine}`);
  if (hasValue(listing.location)) lines.push(`📍 ${listing.location}`);
  if (hasValue(listing.auctionDate)) lines.push(`🗓 ${listing.auctionDate}`);

  // Identifiers
  if (hasValue(listing.lot)) lines.push('', `Лот: ${listing.lot}`);
  if (hasValue(listing.vin)) lines.push(`VIN: <code>${listing.vin}</code>`);

  lines.push('', `<a href="${listing.link}">🔗 Подробнее</a>`);

  return lines.join('\n');
};

const truncateCaption = (text: string): string =>
  text.length <= TELEGRAM_CAPTION_LIMIT ? text : text.slice(0, TELEGRAM_CAPTION_LIMIT - 3) + '...';
