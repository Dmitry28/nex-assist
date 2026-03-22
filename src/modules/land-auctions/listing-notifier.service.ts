import { Injectable } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { TelegramService } from '../telegram/telegram.service';
import type { LandAuctionsResult, Listing } from './dto/listing.dto';
import {
  EMPTY_VALUES,
  MEDIA_GROUP_LIMIT,
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

  /** Send the daily run summary and per-listing messages for new/removed/special listings. */
  async notifyRunResult(result: LandAuctionsResult): Promise<void> {
    const { total, newListings, removedListings, specialListings, newSpecialListings } = result;

    await this.telegram.sendMessage(
      buildSummary(
        total,
        newListings.length,
        removedListings.length,
        specialListings.length,
        newSpecialListings.length,
      ),
    );

    if (newListings.length) await this.sendListings(newListings, 'Новые:');
    if (removedListings.length) await this.sendListings(removedListings, 'Удаленные:');
    if (newSpecialListings.length) await this.sendListings(newSpecialListings, 'Новые в Заболоть:');
  }

  /** Send a critical error notification. */
  async notifyError(message: string): Promise<void> {
    await this.telegram.sendMessage(`⚠️ Ошибка скрапинга:\n<code>${message}</code>`);
  }

  /** Send all listings sequentially with a delay to stay within Telegram rate limits. */
  private async sendListings(listings: Listing[], header: string): Promise<void> {
    const failed: Listing[] = [];

    for (let i = 0; i < listings.length; i++) {
      const ok = await this.sendListing(listings[i], header, i + 1, listings.length);
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
  private async sendListing(
    listing: Listing,
    header: string,
    index: number,
    total: number,
  ): Promise<boolean> {
    const caption = truncateCaption(buildCaption(listing, header, index, total));
    const photos = (listing.images ?? []).slice(0, MEDIA_GROUP_LIMIT);

    if (photos.length > 1) {
      const media: TelegramBot.InputMediaPhoto[] = photos.map((url, i) => ({
        type: 'photo',
        media: url,
        // Only the first photo in a media group carries the caption
        ...(i === 0 ? { caption, parse_mode: 'HTML' as const } : {}),
      }));
      return this.telegram.sendMediaGroup(media);
    }

    if (photos.length === 1) {
      return this.telegram.sendPhoto(photos[0], caption);
    }

    return this.telegram.sendMessage(caption);
  }
}

// ─── Domain formatting helpers ────────────────────────────────────────────────

const isEmpty = (val: string | undefined): boolean => !val || EMPTY_VALUES.has(val);

const buildSummary = (
  total: number,
  newCount: number,
  removedCount: number,
  specialCount: number,
  newSpecialCount: number,
): string =>
  [
    `<b>📊 Сводка на ${new Date().toLocaleDateString('ru-RU')}</b>`,
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

const buildCaption = (listing: Listing, header: string, index: number, total: number): string => {
  const emoji = getListingEmoji(listing.title);
  const lines: string[] = [
    `<b>${header} · ${index} из ${total}</b>`,
    '',
    `${emoji} <b>${listing.title}</b>`,
  ];

  if (!isEmpty(listing.address)) lines.push(`📍 ${listing.address}`);

  const pricePart = !isEmpty(listing.price) ? `💰 ${listing.price}` : '';
  const areaPart = !isEmpty(listing.area) ? `📐 ${listing.area}` : '';
  if (pricePart || areaPart)
    lines.push(['', pricePart, areaPart].filter(Boolean).join('  ·  ').trim());

  if (!isEmpty(listing.auctionDate))
    lines.push(`🗓 Аукцион: ${formatAuctionDate(listing.auctionDate!)}`);
  if (!isEmpty(listing.applicationDeadline))
    lines.push(`📅 Заявки до: ${formatDeadline(listing.applicationDeadline!)}`);
  if (!isEmpty(listing.communications)) lines.push(`⚡ ${listing.communications}`);

  const linkParts: string[] = [`<a href="${listing.link}">🔗 Подробнее</a>`];
  if (listing.cadastralMapUrl) linkParts.push(`<a href="${listing.cadastralMapUrl}">📌 Карта</a>`);
  lines.push('', linkParts.join('  ·  '));

  return lines.join('\n');
};

const truncateCaption = (text: string): string =>
  text.length <= TELEGRAM_CAPTION_LIMIT ? text : text.slice(0, TELEGRAM_CAPTION_LIMIT - 3) + '...';

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
