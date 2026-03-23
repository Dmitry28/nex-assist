import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';
import { sleep } from '../../common/utils/sleep';
import { TELEGRAM_SEND_DELAY_MS, truncateCaption } from '../../common/utils/telegram';
import { TelegramService } from '../telegram/telegram.service';
import type {
  KufarFeedResult,
  KufarListing,
  KufarPriceChange,
  KufarResult,
} from './dto/kufar-listing.dto';
import {
  EMPTY_VALUES,
  FEED_DISPLAY_NAMES,
  MAX_PRICE_CHANGES_IN_SUMMARY,
  MEDIA_GROUP_LIMIT,
  NOTIFICATION_HEADERS,
} from './constants';

/**
 * Tracks which listings were successfully delivered to Telegram.
 * Service uses this to decide what to persist — only notified listings are saved.
 */
export interface KufarNotifyResult {
  /** adIds successfully sent as new listings, keyed by feedName */
  notifiedNew: Map<string, Set<number>>;
  /** adIds successfully sent as price changes, keyed by feedName */
  notifiedPriceChanges: Map<string, Set<number>>;
}

/**
 * Sends Kufar notifications via Telegram.
 * One summary message per run, then per-listing messages (with photos) for each feed.
 */
@Injectable()
export class KufarNotifierService {
  private readonly logger = new Logger(KufarNotifierService.name);
  private readonly chatId: string;

  constructor(
    private readonly telegram: TelegramService,
    config: ConfigService,
  ) {
    this.chatId = config.get<string>('kufar.chatId') ?? '';
    if (!this.chatId) {
      this.logger.warn(
        'TELEGRAM_KUFAR_CHAT_ID is not set — notifications disabled, nothing will be persisted',
      );
    }
  }

  async notifyRunResult(result: KufarResult): Promise<KufarNotifyResult> {
    const empty: KufarNotifyResult = {
      notifiedNew: new Map(),
      notifiedPriceChanges: new Map(),
    };

    if (!this.chatId) return empty;

    const { feeds } = result;

    const summaryOk = await this.telegram.sendMessage(this.chatId, buildSummary(feeds));
    if (!summaryOk) {
      this.logger.error('Failed to send Kufar summary — skipping all notifications');
      return empty;
    }

    const notifiedNew = new Map<string, Set<number>>();
    const notifiedPriceChanges = new Map<string, Set<number>>();

    for (const feed of feeds) {
      const displayName = FEED_DISPLAY_NAMES[feed.feedName] ?? feed.feedName;

      if (feed.newListings.length) {
        const sent = await this.sendListings(
          feed.newListings,
          `${NOTIFICATION_HEADERS.new} · ${displayName}`,
        );
        notifiedNew.set(feed.feedName, sent);
      }

      if (feed.priceChanges.length) {
        const sent = await this.sendPriceChanges(feed.priceChanges, displayName);
        notifiedPriceChanges.set(feed.feedName, sent);
      }
    }

    return { notifiedNew, notifiedPriceChanges };
  }

  async notifyError(message: string): Promise<void> {
    if (!this.chatId) return;
    const ok = await this.telegram.sendMessage(
      this.chatId,
      `⚠️ Ошибка скрапинга Kufar:\n<code>${message}</code>`,
    );
    if (!ok) this.logger.warn('Failed to send Kufar error notification');
  }

  private async sendListings(listings: KufarListing[], header: string): Promise<Set<number>> {
    return this.sendBatch(
      listings,
      (listing, index, total) => ({
        caption: buildListingCaption({ listing, header, index, total }),
        images: listing.images,
      }),
      l => l.adId,
      l => l.title,
      'объект(а)',
    );
  }

  private async sendPriceChanges(
    changes: KufarPriceChange[],
    displayName: string,
  ): Promise<Set<number>> {
    const header = `${NOTIFICATION_HEADERS.priceChange} · ${displayName}`;
    return this.sendBatch(
      changes,
      (change, index, total) => ({
        caption: buildPriceChangeCaption({ change, header, index, total }),
        images: change.listing.images,
      }),
      c => c.listing.adId,
      c => c.listing.title,
      'изменение(й) цены',
    );
  }

  /** Generic send loop — iterates items, tracks delivered/failed, reports failures. */
  private async sendBatch<T>(
    items: T[],
    toMessage: (item: T, index: number, total: number) => { caption: string; images: string[] },
    getId: (item: T) => number,
    getTitle: (item: T) => string,
    failedLabel: string,
  ): Promise<Set<number>> {
    const notified = new Set<number>();
    const failed: T[] = [];

    for (const [i, item] of items.entries()) {
      const { caption, images } = toMessage(item, i + 1, items.length);
      const ok = await this.sendListing({ caption: truncateCaption(caption), images });
      if (ok) notified.add(getId(item));
      else failed.push(item);
      if (i < items.length - 1) await sleep(TELEGRAM_SEND_DELAY_MS);
    }

    if (failed.length > 0) {
      const list = failed.map(item => `• ${getTitle(item)}`).join('\n');
      await this.telegram.sendMessage(
        this.chatId,
        `⚠️ Не удалось отправить ${failed.length} ${failedLabel}:\n${list}`,
      );
    }

    return notified;
  }

  private async sendListing({
    caption,
    images,
  }: {
    caption: string;
    images: string[];
  }): Promise<boolean> {
    const photos = images.slice(0, MEDIA_GROUP_LIMIT);

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

// ─── Formatting helpers ───────────────────────────────────────────────────────

const hasValue = (val: string | number | undefined): val is string | number =>
  val !== undefined && val !== null && !EMPTY_VALUES.has(String(val));

const formatDate = (isoString: string): string => {
  const date = new Date(isoString);
  const now = new Date();
  const diffH = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

  if (diffH < 24) {
    return `сегодня ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Minsk' })}`;
  }
  if (diffH < 48) {
    return `вчера ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Minsk' })}`;
  }
  return date.toLocaleDateString('ru-RU', { timeZone: 'Europe/Minsk' });
};

const formatPrice = (byn?: number, usd?: number): string => {
  const parts: string[] = [];
  if (byn !== undefined && byn > 0) parts.push(`${byn.toLocaleString('ru-RU')} BYN`);
  if (usd !== undefined && usd > 0) parts.push(`$${usd.toLocaleString('ru-RU')}`);
  return parts.join(' / ');
};

interface ListingCaptionParams {
  listing: KufarListing;
  header: string;
  index: number;
  total: number;
}

interface PriceChangeCaptionParams {
  change: KufarPriceChange;
  header: string;
  index: number;
  total: number;
}

const buildListingCaption = ({ listing, header, index, total }: ListingCaptionParams): string => {
  const lines: string[] = [
    `<b>${header} · ${index}/${total}</b>`,
    '',
    `🏠 <b>${listing.title}</b>`,
  ];

  if (hasValue(listing.description)) lines.push(`<i>${listing.description}</i>`);

  lines.push('');
  if (hasValue(listing.address)) lines.push(`📍 ${listing.address}`);
  if (hasValue(listing.propertyType)) lines.push(`🏷 ${listing.propertyType}`);

  const price = formatPrice(listing.priceByn, listing.priceUsd);
  if (price) lines.push(`💰 ${price}`);
  if (hasValue(listing.area)) lines.push(`📐 ${listing.area} м²`);
  if (hasValue(listing.plotArea)) lines.push(`🌱 ${listing.plotArea} сот.`);
  if (hasValue(listing.rooms)) lines.push(`🚪 ${listing.rooms} комн.`);
  if (hasValue(listing.yearBuilt)) lines.push(`📅 ${listing.yearBuilt} г.п.`);
  if (listing.features && listing.features.length > 0)
    lines.push(`✅ ${listing.features.join(', ')}`);
  if (hasValue(listing.seller)) lines.push(`👤 ${listing.seller}`);

  lines.push(`🕐 ${formatDate(listing.listTime)}`);
  lines.push('', `<a href="${listing.link}">🔗 Подробнее</a>`);

  return lines.join('\n');
};

const buildPriceChangeCaption = ({
  change,
  header,
  index,
  total,
}: PriceChangeCaptionParams): string => {
  const { listing, oldPriceByn, oldPriceUsd } = change;
  const lines: string[] = [
    `<b>${header} · ${index}/${total}</b>`,
    '',
    `🏠 <b>${listing.title}</b>`,
  ];

  if (hasValue(listing.address)) lines.push(`📍 ${listing.address}`);

  // Old price → new price
  const oldPrice = formatPrice(oldPriceByn, oldPriceUsd);
  const newPrice = formatPrice(listing.priceByn, listing.priceUsd);
  if (oldPrice || newPrice) {
    lines.push(`💰 ${oldPrice || '—'} → <b>${newPrice || '—'}</b>`);
  }

  if (hasValue(listing.area)) lines.push(`📐 ${listing.area} м²`);
  if (hasValue(listing.plotArea)) lines.push(`🌱 ${listing.plotArea} сот.`);
  if (hasValue(listing.rooms)) lines.push(`🚪 ${listing.rooms} комн.`);
  if (hasValue(listing.yearBuilt)) lines.push(`📅 ${listing.yearBuilt} г.п.`);
  lines.push('', `<a href="${listing.link}">🔗 Подробнее</a>`);

  return lines.join('\n');
};

const buildSummary = (feeds: KufarFeedResult[]): string => {
  const date = new Date().toLocaleDateString('ru-RU');
  const lines = [`<b>🏘 Kufar · ${date}</b>`];

  for (const feed of feeds) {
    const name = FEED_DISPLAY_NAMES[feed.feedName] ?? feed.feedName;
    const parts: string[] = [];
    if (feed.newListings.length > 0) parts.push(`🆕 ${feed.newListings.length} новых`);
    if (feed.priceChanges.length > 0) parts.push(`💸 ${feed.priceChanges.length} изм. цены`);
    const status = parts.length > 0 ? parts.join(', ') : 'без изменений';
    lines.push('', `<b>${name}:</b> ${status}`);

    // List price changes inline with link: title + old → new price
    if (feed.priceChanges.length > 0) {
      const shown = feed.priceChanges.slice(0, MAX_PRICE_CHANGES_IN_SUMMARY);
      for (const { listing, oldPriceByn, oldPriceUsd } of shown) {
        const oldPrice = formatPrice(oldPriceByn, oldPriceUsd) || '—';
        const newPrice = formatPrice(listing.priceByn, listing.priceUsd) || '—';
        const shortTitle =
          listing.title.length > 35 ? listing.title.slice(0, 32) + '...' : listing.title;
        lines.push(
          `  • <a href="${listing.link}">${shortTitle}</a>: <s>${oldPrice}</s> → <b>${newPrice}</b>`,
        );
      }
      if (feed.priceChanges.length > MAX_PRICE_CHANGES_IN_SUMMARY) {
        lines.push(`  <i>...и ещё ${feed.priceChanges.length - MAX_PRICE_CHANGES_IN_SUMMARY}</i>`);
      }
    }
  }

  return lines.join('\n');
};
