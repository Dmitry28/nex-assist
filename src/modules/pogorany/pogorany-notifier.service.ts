import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';
import {
  TELEGRAM_MEDIA_GROUP_LIMIT,
  TELEGRAM_MESSAGE_LIMIT,
  truncateText,
} from '../../common/utils/telegram';
import { TelegramService } from '../telegram/telegram.service';
import { NOTIFICATION_HEADERS } from './constants';
import type {
  PogoranyListing,
  PogoranyPriceChange,
  PogoranyResult,
} from './dto/pogorany-listing.dto';
import {
  buildListingCaption,
  buildPriceChangeCaption,
  buildRemovedCaption,
  buildSummary,
} from './pogorany-format';

/** Tracks which listings were successfully delivered — service uses this to gate persistence. */
export interface PogoranyNotifyResult {
  notifiedNew: Set<number>;
  notifiedRemoved: Set<number>;
  notifiedPriceChanges: Set<number>;
}

const emptyResult = (): PogoranyNotifyResult => ({
  notifiedNew: new Set(),
  notifiedRemoved: new Set(),
  notifiedPriceChanges: new Set(),
});

@Injectable()
export class PogoranyNotifierService {
  private readonly logger = new Logger(PogoranyNotifierService.name);
  private readonly chatId: string;

  constructor(
    private readonly telegram: TelegramService,
    config: ConfigService,
  ) {
    this.chatId = config.get<string>('pogorany.chatId') ?? '';
    if (!this.chatId) {
      this.logger.warn(
        'TELEGRAM_POGORANY_CHAT_ID is not set — notifications disabled, nothing will be persisted',
      );
    }
  }

  async notifyRunResult(result: PogoranyResult): Promise<PogoranyNotifyResult> {
    if (!this.chatId) return emptyResult();

    const summaryOk = await this.telegram.sendMessage(this.chatId, buildSummary(result));
    if (!summaryOk) {
      this.logger.error('Failed to send pogorany summary — skipping all notifications');
      return emptyResult();
    }
    this.logger.log('Summary sent to Telegram');

    // Catalog is tiny (~3 lots) — always send per-listing details, including baseline.
    // Service still persists all listings unconditionally on baseline so a transient
    // Telegram failure won't cause re-flooding on the next run.
    const notifiedNew = await this.sendListings(
      result.newListings,
      NOTIFICATION_HEADERS.new,
      buildListingCaption,
    );
    const notifiedPriceChanges = await this.sendPriceChanges(result.priceChanges);
    const notifiedRemoved = await this.sendListings(
      result.removedListings,
      NOTIFICATION_HEADERS.removed,
      buildRemovedCaption,
    );

    return { notifiedNew, notifiedRemoved, notifiedPriceChanges };
  }

  async notifyError(message: string): Promise<void> {
    if (!this.chatId) return;
    const ok = await this.telegram.sendMessage(
      this.chatId,
      `⚠️ Ошибка скрапинга pogorany.by:\n<code>${message}</code>`,
    );
    if (!ok) this.logger.warn('Failed to send pogorany error notification');
  }

  private async sendListings(
    listings: PogoranyListing[],
    header: string,
    captionBuilder: (params: {
      listing: PogoranyListing;
      header: string;
      index: number;
      total: number;
    }) => string,
  ): Promise<Set<number>> {
    const notified = new Set<number>();
    if (listings.length === 0) return notified;

    this.logger.log(`Sending ${listings.length} listing(s): ${header}`);

    for (const [i, listing] of listings.entries()) {
      const caption = captionBuilder({
        listing,
        header,
        index: i + 1,
        total: listings.length,
      });
      const ok = await this.sendListing(caption, listing.images);
      if (ok) notified.add(listing.uid);
      else this.logger.warn(`Failed to send listing uid=${listing.uid} (${listing.title})`);
    }

    return notified;
  }

  private async sendPriceChanges(changes: PogoranyPriceChange[]): Promise<Set<number>> {
    const notified = new Set<number>();
    if (changes.length === 0) return notified;

    this.logger.log(`Sending ${changes.length} price change(s)`);

    for (const [i, change] of changes.entries()) {
      const caption = buildPriceChangeCaption({
        change,
        header: NOTIFICATION_HEADERS.priceChange,
        index: i + 1,
        total: changes.length,
      });
      const ok = await this.sendListing(caption, change.listing.images);
      if (ok) notified.add(change.listing.uid);
      else this.logger.warn(`Failed to send price change for uid=${change.listing.uid}`);
    }

    return notified;
  }

  private async sendListing(caption: string, images: string[]): Promise<boolean> {
    const photos = images.slice(0, TELEGRAM_MEDIA_GROUP_LIMIT);
    const captionFor1024 = truncateText(caption);

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

    return this.telegram.sendMessage(this.chatId, truncateText(caption, TELEGRAM_MESSAGE_LIMIT));
  }
}
