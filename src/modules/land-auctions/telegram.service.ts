import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';
import type { Listing } from './dto/listing.dto';
import {
  EMPTY_VALUES,
  MEDIA_GROUP_LIMIT,
  TELEGRAM_CAPTION_LIMIT,
  TELEGRAM_SEND_DELAY_MS,
  TELEGRAM_SEND_RETRIES,
} from './constants';

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private bot!: TelegramBot;
  private chatId!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const token = this.config.getOrThrow<string>('landAuctions.telegramToken');
    this.chatId = this.config.getOrThrow<string>('landAuctions.telegramChatId');
    // polling: false — we only send messages, never receive them
    this.bot = new TelegramBot(token, { polling: false });
  }

  async sendMessage(text: string): Promise<void> {
    try {
      await this.bot.sendMessage(this.chatId, text, { parse_mode: 'HTML' });
    } catch (error) {
      this.logger.error('Failed to send Telegram message', error);
    }
  }

  /** Send all listings as individual Telegram messages with a delay between each. */
  async sendListingMessages(listings: Listing[], header: string): Promise<void> {
    const failed: Listing[] = [];

    for (let i = 0; i < listings.length; i++) {
      const ok = await this.sendListingMessage(listings[i], header, i + 1, listings.length);
      if (!ok) failed.push(listings[i]);
      if (i < listings.length - 1) await sleep(TELEGRAM_SEND_DELAY_MS);
    }

    if (failed.length > 0) {
      const list = failed.map(l => `• ${l.title}`).join('\n');
      await this.sendMessage(`⚠️ Не удалось отправить ${failed.length} объект(а):\n${list}`);
    }
  }

  /** Send one listing as a photo/media group (or plain message if no images). */
  private async sendListingMessage(
    listing: Listing,
    header: string,
    index: number,
    total: number,
  ): Promise<boolean> {
    const caption = truncateCaption(buildCaption(listing, header, index, total));
    const photos = (listing.images ?? []).slice(0, MEDIA_GROUP_LIMIT);

    return this.sendWithRetry(async () => {
      if (photos.length > 1) {
        const media: TelegramBot.InputMediaPhoto[] = photos.map((url, i) => ({
          type: 'photo',
          media: url,
          // Only the first photo in a media group carries the caption
          ...(i === 0 ? { caption, parse_mode: 'HTML' as const } : {}),
        }));
        await this.bot.sendMediaGroup(this.chatId, media);
      } else if (photos.length === 1) {
        await this.bot.sendPhoto(this.chatId, photos[0], { caption, parse_mode: 'HTML' });
      } else {
        await this.bot.sendMessage(this.chatId, caption, { parse_mode: 'HTML' });
      }
    });
  }

  /**
   * Retry wrapper that handles Telegram rate-limit errors (429).
   * On rate limit, waits `retry_after` seconds before the next attempt.
   */
  private async sendWithRetry(fn: () => Promise<void>): Promise<boolean> {
    for (let attempt = 0; attempt < TELEGRAM_SEND_RETRIES; attempt++) {
      try {
        await fn();
        return true;
      } catch (error: unknown) {
        const retryAfter = extractRetryAfter(error);
        if (retryAfter !== null && attempt < TELEGRAM_SEND_RETRIES - 1) {
          this.logger.warn(`Telegram rate limit, waiting ${retryAfter}s...`);
          await sleep(retryAfter * 1000 + 500);
        } else {
          this.logger.error('Failed to send listing message', error);
          return false;
        }
      }
    }
    return false;
  }
}

// ─── Pure formatting helpers ─────────────────────────────────────────────────

const isEmpty = (val: string | undefined): boolean => !val || EMPTY_VALUES.has(val);

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
  // Truncate overly long dates (e.g. full sentences)
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

const truncateCaption = (text: string): string => {
  if (text.length <= TELEGRAM_CAPTION_LIMIT) return text;
  return text.slice(0, TELEGRAM_CAPTION_LIMIT - 3) + '...';
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Extract `retry_after` seconds from a Telegram 429 rate-limit error, or null. */
const extractRetryAfter = (error: unknown): number | null => {
  if (typeof error !== 'object' || error === null) return null;
  const retryAfter = (error as { response?: { body?: { parameters?: { retry_after?: unknown } } } })
    .response?.body?.parameters?.retry_after;
  return typeof retryAfter === 'number' ? retryAfter : null;
};
