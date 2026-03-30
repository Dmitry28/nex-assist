import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';
import {
  TELEGRAM_MEDIA_GROUP_LIMIT,
  TELEGRAM_MESSAGE_LIMIT,
  truncateText,
} from '../../common/utils/telegram';
import { TelegramService } from '../telegram/telegram.service';
import type { LandAuctionsResult, Listing } from './dto/listing.dto';
import { NOTIFICATION_HEADERS } from './constants';
import { buildCaption, buildSummary, type CaptionParams } from './listing-format';

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
    const {
      total,
      newListings,
      removedListings,
      soldListings,
      specialListings,
      newSpecialListings,
    } = result;

    const ok = await this.telegram.sendMessage(
      this.chatId,
      buildSummary({
        date: new Date(),
        total,
        newCount: newListings.length,
        removedCount: removedListings.length,
        soldCount: soldListings.length,
        specialCount: specialListings.length,
        newSpecialCount: newSpecialListings.length,
      }),
    );

    if (!ok) throw new Error('Не удалось отправить сводку в Telegram');

    if (newListings.length) await this.sendListings(newListings, NOTIFICATION_HEADERS.new);
    if (removedListings.length)
      await this.sendListings(removedListings, NOTIFICATION_HEADERS.removed);
    if (soldListings.length) await this.sendListings(soldListings, NOTIFICATION_HEADERS.sold);
    if (newSpecialListings.length)
      await this.sendListings(newSpecialListings, NOTIFICATION_HEADERS.newSpecial);
  }

  /** Send a critical error notification. */
  async notifyError(message: string): Promise<void> {
    if (!this.chatId) return;
    const ok = await this.telegram.sendMessage(
      this.chatId,
      `⚠️ Ошибка скрапинга:\n<code>${message}</code>`,
    );
    if (!ok) this.logger.warn('Failed to send error notification to Telegram');
  }

  /** Send all listings sequentially with a delay to stay within Telegram rate limits. */
  private async sendListings(listings: Listing[], header: string): Promise<void> {
    const failed: Listing[] = [];

    this.logger.log(`Sending ${listings.length} ${header}`);

    for (const [i, listing] of listings.entries()) {
      const ok = await this.sendListing({ listing, header, index: i + 1, total: listings.length });
      if (!ok) failed.push(listing);
    }

    if (failed.length > 0) {
      this.logger.warn(`${failed.length} listings failed to send`);
      const list = failed.map(l => `• ${l.title ?? l.link ?? 'unknown'}`).join('\n');
      await this.telegram.sendMessage(
        this.chatId,
        `⚠️ Не удалось отправить ${failed.length} объект(а):\n${list}`,
      );
    }
  }

  /** Send a single listing as photo/media group or plain text if no images. */
  private async sendListing({ listing, header, index, total }: CaptionParams): Promise<boolean> {
    const rawCaption = buildCaption({ listing, header, index, total });
    const photos = (listing.images ?? []).slice(0, TELEGRAM_MEDIA_GROUP_LIMIT);
    const captionFor1024 = truncateText(rawCaption); // photo/media-group: 1024-char limit

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

    return this.telegram.sendMessage(this.chatId, truncateText(rawCaption, TELEGRAM_MESSAGE_LIMIT)); // text: 4096-char limit
  }
}
