import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';
import {
  TELEGRAM_MEDIA_GROUP_LIMIT,
  TELEGRAM_MESSAGE_LIMIT,
  truncateText,
} from '../../common/utils/telegram';
import { TelegramService } from '../telegram/telegram.service';
import type { KufarListing, KufarPriceChange, KufarResult } from './dto/kufar-listing.dto';
import { FEED_DISPLAY_NAMES, NOTIFICATION_HEADERS } from './constants';
import { buildListingCaption, buildPriceChangeCaption, buildSummary } from './kufar-format';

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
    this.logger.log('Summary sent to Telegram');

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

    this.logger.log(`Sending ${items.length} ${failedLabel}`);

    for (const [i, item] of items.entries()) {
      const { caption, images } = toMessage(item, i + 1, items.length);
      const ok = await this.sendListing({ caption, images });
      if (ok) notified.add(getId(item));
      else failed.push(item);
    }

    if (failed.length > 0) {
      this.logger.warn(`${failed.length} ${failedLabel} failed to send`);
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
    const photos = images.slice(0, TELEGRAM_MEDIA_GROUP_LIMIT);
    const captionFor1024 = truncateText(caption); // photo/media-group: 1024-char limit

    if (photos.length > 1) {
      const media: TelegramBot.InputMediaPhoto[] = photos.map((url, i) => {
        const item: TelegramBot.InputMediaPhoto = { type: 'photo', media: url };
        if (i === 0) {
          item.caption = captionFor1024;
          item.parse_mode = 'HTML';
        }
        return item;
      });
      return this.telegram.sendMediaGroup(this.chatId, media);
    }

    if (photos.length === 1) {
      return this.telegram.sendPhoto(this.chatId, photos[0], captionFor1024);
    }

    return this.telegram.sendMessage(this.chatId, truncateText(caption, TELEGRAM_MESSAGE_LIMIT)); // text: 4096-char limit
  }
}
