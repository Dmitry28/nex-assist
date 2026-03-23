import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';
import { sleep } from '../../common/utils/sleep';
import { TELEGRAM_SEND_DELAY_MS, truncateCaption } from '../../common/utils/telegram';
import { TelegramService } from '../telegram/telegram.service';
import type { LandAuctionsResult, Listing } from './dto/listing.dto';
import {
  EMPTY_VALUES,
  MAX_AUCTION_DATE_LENGTH,
  MEDIA_GROUP_LIMIT,
  NOTIFICATION_HEADERS,
} from './constants';

/**
 * Sends land auction notifications via Telegram.
 * Knows the domain format (captions, emojis, summary layout) but not the Telegram API details —
 * those are handled by the shared TelegramService.
 */
@Injectable()
export class ListingNotifierService {
  private readonly logger = new Logger(ListingNotifierService.name);
  private readonly chatId: string;

  constructor(
    private readonly telegram: TelegramService,
    config: ConfigService,
  ) {
    this.chatId = config.get<string>('landAuctions.chatId') ?? '';
  }

  /**
   * Send the daily run summary and per-listing messages for new/removed/special listings.
   * Throws if the summary message fails — the caller must not persist the snapshot in that case,
   * so the items remain "new" and will be retried on the next run.
   */
  async notifyRunResult(result: LandAuctionsResult): Promise<void> {
    if (!this.chatId) {
      this.logger.warn('chatId not set — skipping Telegram notification');
      return;
    }
    const { total, newListings, removedListings, specialListings, newSpecialListings } = result;

    const ok = await this.telegram.sendMessage(
      this.chatId,
      buildSummary({
        date: new Date(),
        total,
        newCount: newListings.length,
        removedCount: removedListings.length,
        specialCount: specialListings.length,
        newSpecialCount: newSpecialListings.length,
      }),
    );

    if (!ok) throw new Error('Не удалось отправить сводку в Telegram');

    if (newListings.length) await this.sendListings(newListings, NOTIFICATION_HEADERS.new);
    if (removedListings.length)
      await this.sendListings(removedListings, NOTIFICATION_HEADERS.removed);
    if (newSpecialListings.length)
      await this.sendListings(newSpecialListings, NOTIFICATION_HEADERS.newSpecial);
  }

  /** Send a critical error notification. */
  async notifyError(message: string): Promise<void> {
    if (!this.chatId) return;
    await this.telegram.sendMessage(this.chatId, `⚠️ Ошибка скрапинга:\n<code>${message}</code>`);
  }

  /** Send all listings sequentially with a delay to stay within Telegram rate limits. */
  private async sendListings(listings: Listing[], header: string): Promise<void> {
    const failed: Listing[] = [];

    for (const [i, listing] of listings.entries()) {
      const ok = await this.sendListing({ listing, header, index: i + 1, total: listings.length });
      if (!ok) failed.push(listing);
      if (i < listings.length - 1) await sleep(TELEGRAM_SEND_DELAY_MS);
    }

    if (failed.length > 0) {
      const list = failed.map(l => `• ${l.title ?? l.link ?? 'unknown'}`).join('\n');
      await this.telegram.sendMessage(
        this.chatId,
        `⚠️ Не удалось отправить ${failed.length} объект(а):\n${list}`,
      );
    }
  }

  /** Send a single listing as photo/media group or plain text if no images. */
  private async sendListing({
    listing,
    header,
    index,
    total,
  }: SendListingParams): Promise<boolean> {
    const caption = truncateCaption(buildCaption({ listing, header, index, total }));
    const photos = (listing.images ?? []).slice(0, MEDIA_GROUP_LIMIT);

    if (photos.length > 1) {
      const media: TelegramBot.InputMediaPhoto[] = photos.map((url, i) => {
        const item: TelegramBot.InputMediaPhoto = { type: 'photo', media: url };
        if (i === 0) {
          item.caption = caption;
          item.parse_mode = 'HTML';
        }
        return item;
      });
      return this.telegram.sendMediaGroup(this.chatId, media);
    }

    if (photos.length === 1) {
      return this.telegram.sendPhoto(this.chatId, photos[0], caption);
    }

    return this.telegram.sendMessage(this.chatId, caption);
  }
}

// ─── Domain formatting helpers ────────────────────────────────────────────────

/** Type predicate — narrows `string | undefined` to `string`, excluding empty/unknown values. */
const hasValue = (val: string | undefined): val is string => !!val && !EMPTY_VALUES.has(val);

interface SendListingParams {
  listing: Listing;
  header: string;
  index: number;
  total: number;
}

interface SummaryParams {
  date: Date;
  total: number;
  newCount: number;
  removedCount: number;
  specialCount: number;
  newSpecialCount: number;
}

const buildSummary = ({
  date,
  total,
  newCount,
  removedCount,
  specialCount,
  newSpecialCount,
}: SummaryParams): string =>
  [
    `<b>📊 Сводка на ${date.toLocaleDateString('ru-RU')}</b>`,
    `📋 Всего объявлений: <b>${total}</b>`,
    `🆕 Новые: <b>${newCount}</b>`,
    `🗑 Удалённые: <b>${removedCount}</b>`,
    `🌿 Всего в Заболоть: <b>${specialCount}</b>`,
    `✅ Новые в Заболоть: <b>${newSpecialCount}</b>`,
  ].join('\n');

const getListingEmoji = (title: string | undefined): string => {
  if (!title) return '🏡';
  const t = title.toLowerCase();
  if (t.includes('не завершён') || t.includes('незавершён')) return '🏗';
  if (t.includes('жилой дом') || t.includes('дом по')) return '🏠';
  return '🏡';
};

const formatAuctionDate = (val: string): string => {
  if (val.startsWith('Аукцион состоится ')) return val.replace('Аукцион состоится ', '');
  if (val.startsWith('Проведение аукциона планируется '))
    return val.replace('Проведение аукциона планируется ', '');
  // Truncate overly long strings (e.g. full sentences instead of a date)
  if (val.length > MAX_AUCTION_DATE_LENGTH) return 'уточняется';
  return val;
};

const formatDeadline = (val: string): string => val.replace('Заявления принимаются по ', '');

const shortenCommunications = (val: string): string =>
  val
    .replace(/электроснабжение/gi, 'свет')
    .replace(/газоснабжение/gi, 'газ')
    .replace(/водоснабжение/gi, 'вода')
    .replace(/водоотведение/gi, 'канализация')
    .replace(/теплоснабжение/gi, 'тепло');

const buildCaption = ({ listing, header, index, total }: SendListingParams): string => {
  const emoji = getListingEmoji(listing.title);

  // Block 1 — header + title
  const lines: string[] = [
    `<b>${header} · ${index}/${total}</b>`,
    '',
    `${emoji} <b>${listing.title}</b>`,
  ];

  // Block 2 — location + price/area
  const locationBlock: string[] = [];
  if (hasValue(listing.address)) locationBlock.push(`📍 ${listing.address}`);
  const pricePart = hasValue(listing.price) ? `💰 ${listing.price}` : '';
  const areaPart = hasValue(listing.area) ? `📐 ${listing.area}` : '';
  if (pricePart || areaPart)
    locationBlock.push([pricePart, areaPart].filter(Boolean).join('  ·  '));
  if (locationBlock.length) lines.push('', ...locationBlock);

  // Block 3 — dates + communications
  const infoBlock: string[] = [];
  const auctionPart = hasValue(listing.auctionDate)
    ? `🗓 ${formatAuctionDate(listing.auctionDate)}`
    : '';
  const deadlinePart = hasValue(listing.applicationDeadline)
    ? `📅 до ${formatDeadline(listing.applicationDeadline)}`
    : '';
  if (auctionPart || deadlinePart)
    infoBlock.push([auctionPart, deadlinePart].filter(Boolean).join('  ·  '));
  if (hasValue(listing.communications))
    infoBlock.push(`⚡ ${shortenCommunications(listing.communications)}`);
  if (infoBlock.length) lines.push('', ...infoBlock);

  // Block 4 — links
  const linkParts: string[] = [`<a href="${listing.link}">🔗 Подробнее</a>`];
  if (listing.cadastralMapUrl) linkParts.push(`<a href="${listing.cadastralMapUrl}">📌 Карта</a>`);
  lines.push('', linkParts.join('  ·  '));

  return lines.join('\n');
};
