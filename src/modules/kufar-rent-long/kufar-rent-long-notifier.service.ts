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
import type { KufarRentLongListing, KufarRentLongResult } from './dto/kufar-rent-long-listing.dto';
import { buildListingCaption, buildSummary } from './kufar-rent-long-format';

/** Tracks which listings were successfully delivered — service uses this to gate persistence. */
export interface KufarRentLongNotifyResult {
  notifiedNew: Set<number>;
}

const emptyResult = (): KufarRentLongNotifyResult => ({ notifiedNew: new Set() });

@Injectable()
export class KufarRentLongNotifierService {
  private readonly logger = new Logger(KufarRentLongNotifierService.name);
  private readonly chatId: string;

  constructor(
    private readonly telegram: TelegramService,
    config: ConfigService,
  ) {
    this.chatId = config.get<string>('kufarRentLong.chatId') ?? '';
    if (!this.chatId) {
      this.logger.warn(
        'TELEGRAM_KUFAR_RENT_LONG_CHAT_ID is not set — notifications disabled, nothing will be persisted',
      );
    }
  }

  async notifyRunResult(result: KufarRentLongResult): Promise<KufarRentLongNotifyResult> {
    if (!this.chatId) return emptyResult();

    const summaryOk = await this.telegram.sendMessage(this.chatId, buildSummary(result));
    if (!summaryOk) {
      this.logger.error('Failed to send kufar-rent-long summary — skipping all notifications');
      return emptyResult();
    }
    this.logger.log('Summary sent to Telegram');

    // Catalog is tiny (~5 lots in narrow bbox) — always send per-listing details, including baseline.
    // On baseline, `result.newListings` already contains the full set.
    // Service persists all listings unconditionally on baseline so a transient Telegram failure
    // won't cause re-flooding on the next run.
    const notifiedNew = await this.sendListings(result.newListings, NOTIFICATION_HEADERS.new);
    return { notifiedNew };
  }

  async notifyError(message: string): Promise<void> {
    if (!this.chatId) return;
    const ok = await this.telegram.sendMessage(
      this.chatId,
      `⚠️ Ошибка скрапинга re.kufar.by (аренда):\n<code>${message}</code>`,
    );
    if (!ok) this.logger.warn('Failed to send kufar-rent-long error notification');
  }

  private async sendListings(
    listings: KufarRentLongListing[],
    header: string,
  ): Promise<Set<number>> {
    const notified = new Set<number>();
    if (listings.length === 0) return notified;

    this.logger.log(`Sending ${listings.length} listing(s): ${header}`);

    for (const [i, listing] of listings.entries()) {
      const caption = buildListingCaption({
        listing,
        header,
        index: i + 1,
        total: listings.length,
      });
      const ok = await this.sendListing(caption, listing.images);
      if (ok) notified.add(listing.adId);
      else this.logger.warn(`Failed to send listing adId=${listing.adId} (${listing.title})`);
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
