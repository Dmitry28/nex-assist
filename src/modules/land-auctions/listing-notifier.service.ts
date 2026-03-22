import { Injectable } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { sleep } from '../../common/utils/sleep';
import { TelegramService } from '../telegram/telegram.service';
import type { LandAuctionsResult, Listing } from './dto/listing.dto';
import {
  EMPTY_VALUES,
  MEDIA_GROUP_LIMIT,
  NOTIFICATION_HEADERS,
  TELEGRAM_CAPTION_LIMIT,
  TELEGRAM_SEND_DELAY_MS,
} from './constants';

/**
 * Sends land auction notifications via Telegram.
 * Knows the domain format (captions, emojis, summary layout) but not the Telegram API details —
 * those are handled by the shared TelegramService.
 */
@Injectable()
export class ListingNotifierService {
  constructor(private readonly telegram: TelegramService) {}

  /**
   * Send the daily run summary and per-listing messages for new/removed/special listings.
   * Throws if the summary message fails — the caller must not persist the snapshot in that case,
   * so the items remain "new" and will be retried on the next run.
   */
  async notifyRunResult(result: LandAuctionsResult): Promise<void> {
    const { total, newListings, removedListings, specialListings, newSpecialListings } = result;

    const ok = await this.telegram.sendMessage(
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
    await this.telegram.sendMessage(`⚠️ Ошибка скрапинга:\n<code>${message}</code>`);
  }

  /** Send all listings sequentially with a delay to stay within Telegram rate limits. */
  private async sendListings(listings: Listing[], header: string): Promise<void> {
    const failed: Listing[] = [];

    for (let i = 0; i < listings.length; i++) {
      const ok = await this.sendListing({
        listing: listings[i],
        header,
        index: i + 1,
        total: listings.length,
      });
      if (!ok) failed.push(listings[i]);
      if (i < listings.length - 1) await sleep(TELEGRAM_SEND_DELAY_MS);
    }

    if (failed.length > 0) {
      const list = failed.map(l => `• ${l.title}`).join('\n');
      await this.telegram.sendMessage(
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
      return this.telegram.sendMediaGroup(media);
    }

    if (photos.length === 1) {
      return this.telegram.sendPhoto(photos[0], caption);
    }

    return this.telegram.sendMessage(caption);
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
    newCount ? `🆕 Новые: <b>${newCount}</b>` : '🆕 Новые: 0',
    removedCount ? `🗑 Удалённые: <b>${removedCount}</b>` : '🗑 Удалённые: 0',
    `🌿 Всего в Заболоть: <b>${specialCount}</b>`,
    newSpecialCount ? `✅ Новые в Заболоть: <b>${newSpecialCount}</b>` : '✅ Новые в Заболоть: 0',
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
  if (val.length > 50) return 'уточняется';
  return val;
};

const formatDeadline = (val: string): string => val.replace('Заявления принимаются по ', '');

const buildCaption = ({ listing, header, index, total }: SendListingParams): string => {
  const emoji = getListingEmoji(listing.title);
  const lines: string[] = [
    `<b>${header} · ${index} из ${total}</b>`,
    '',
    `${emoji} <b>${listing.title}</b>`,
  ];

  if (hasValue(listing.address)) lines.push(`📍 ${listing.address}`);

  const pricePart = hasValue(listing.price) ? `💰 ${listing.price}` : '';
  const areaPart = hasValue(listing.area) ? `📐 ${listing.area}` : '';
  if (pricePart || areaPart)
    lines.push(['', pricePart, areaPart].filter(Boolean).join('  ·  ').trim());

  if (hasValue(listing.auctionDate))
    lines.push(`🗓 Аукцион: ${formatAuctionDate(listing.auctionDate)}`);
  if (hasValue(listing.applicationDeadline))
    lines.push(`📅 Заявки до: ${formatDeadline(listing.applicationDeadline)}`);
  if (hasValue(listing.communications)) lines.push(`⚡ ${listing.communications}`);

  const linkParts: string[] = [`<a href="${listing.link}">🔗 Подробнее</a>`];
  if (listing.cadastralMapUrl) linkParts.push(`<a href="${listing.cadastralMapUrl}">📌 Карта</a>`);
  lines.push('', linkParts.join('  ·  '));

  return lines.join('\n');
};

const truncateCaption = (text: string): string =>
  text.length <= TELEGRAM_CAPTION_LIMIT ? text : text.slice(0, TELEGRAM_CAPTION_LIMIT - 3) + '...';
