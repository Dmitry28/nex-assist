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
  MEDIA_GROUP_LIMIT,
  NOTIFICATION_HEADERS,
} from './constants';

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
  }

  async notifyRunResult(result: KufarResult): Promise<void> {
    if (!this.chatId) {
      this.logger.warn('chatId not set — skipping Telegram notification');
      return;
    }

    const { feeds } = result;
    const hasAnything = feeds.some(f => f.newListings.length > 0 || f.priceChanges.length > 0);

    const ok = await this.telegram.sendMessage(this.chatId, buildSummary(feeds));
    if (!ok) throw new Error('Не удалось отправить сводку Kufar в Telegram');

    if (!hasAnything) return;

    for (const feed of feeds) {
      const displayName = FEED_DISPLAY_NAMES[feed.feedName] ?? feed.feedName;

      if (feed.newListings.length) {
        await this.sendListings(
          feed.newListings,
          `${NOTIFICATION_HEADERS.new} · ${displayName}`,
          feed.newListings.length,
        );
      }

      if (feed.priceChanges.length) {
        await this.sendPriceChanges(feed.priceChanges, displayName);
      }
    }
  }

  async notifyError(message: string): Promise<void> {
    if (!this.chatId) return;
    const ok = await this.telegram.sendMessage(
      this.chatId,
      `⚠️ Ошибка скрапинга Kufar:\n<code>${message}</code>`,
    );
    if (!ok) this.logger.warn('Failed to send Kufar error notification');
  }

  private async sendListings(
    listings: KufarListing[],
    header: string,
    total: number,
  ): Promise<void> {
    const failed: KufarListing[] = [];

    for (const [i, listing] of listings.entries()) {
      const ok = await this.sendListing({
        caption: truncateCaption(buildListingCaption({ listing, header, index: i + 1, total })),
        images: listing.images,
      });
      if (!ok) failed.push(listing);
      if (i < listings.length - 1) await sleep(TELEGRAM_SEND_DELAY_MS);
    }

    if (failed.length > 0) {
      const list = failed.map(l => `• ${l.title}`).join('\n');
      await this.telegram.sendMessage(
        this.chatId,
        `⚠️ Не удалось отправить ${failed.length} объект(а):\n${list}`,
      );
    }
  }

  private async sendPriceChanges(changes: KufarPriceChange[], displayName: string): Promise<void> {
    const header = `${NOTIFICATION_HEADERS.priceChange} · ${displayName}`;
    const failed: KufarListing[] = [];

    for (const [i, change] of changes.entries()) {
      const ok = await this.sendListing({
        caption: truncateCaption(
          buildPriceChangeCaption({ change, header, index: i + 1, total: changes.length }),
        ),
        images: change.listing.images,
      });
      if (!ok) failed.push(change.listing);
      if (i < changes.length - 1) await sleep(TELEGRAM_SEND_DELAY_MS);
    }

    if (failed.length > 0) {
      const list = failed.map(l => `• ${l.title}`).join('\n');
      await this.telegram.sendMessage(
        this.chatId,
        `⚠️ Не удалось отправить ${failed.length} изменение(й) цены:\n${list}`,
      );
    }
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
  if (byn !== undefined) parts.push(`${byn.toLocaleString('ru-RU')} BYN`);
  if (usd !== undefined) parts.push(`$${usd.toLocaleString('ru-RU')}`);
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

  if (feeds.length === 0) {
    lines.push('Нет активных фидов');
    return lines.join('\n');
  }

  for (const feed of feeds) {
    const name = FEED_DISPLAY_NAMES[feed.feedName] ?? feed.feedName;
    const parts: string[] = [];
    if (feed.newListings.length > 0) parts.push(`🆕 ${feed.newListings.length} новых`);
    if (feed.priceChanges.length > 0) parts.push(`💸 ${feed.priceChanges.length} изм. цены`);
    const status = parts.length > 0 ? parts.join(', ') : 'без изменений';
    lines.push(`${name}: ${status}`);
  }

  return lines.join('\n');
};
