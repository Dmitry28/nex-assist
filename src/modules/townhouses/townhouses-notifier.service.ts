import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { InputMediaPhoto } from 'node-telegram-bot-api';
import { QuietSummaryService } from '../../common/quiet-summary.service';
import {
  TELEGRAM_MEDIA_GROUP_LIMIT,
  TELEGRAM_MESSAGE_LIMIT,
  truncateText,
} from '../../common/utils/telegram';
import { TelegramService } from '../telegram/telegram.service';
import { NOTIFICATION_HEADERS } from './constants';
import type { TownhousesResult } from './dto/townhouse-listing.dto';
import { buildListingCaption, buildPriceChangeCaption, buildSummary } from './townhouses-format';

/**
 * Sends townhouse notifications to the pogorany chat — townhouses are one topic for the
 * owner, so the primary market and both resale sites land in the same channel.
 *
 * Returns the uids actually delivered; the service persists only those.
 */
@Injectable()
export class TownhousesNotifierService {
  private readonly logger = new Logger(TownhousesNotifierService.name);
  private readonly chatId: string;

  constructor(
    private readonly telegram: TelegramService,
    private readonly quiet: QuietSummaryService,
    config: ConfigService,
  ) {
    this.chatId = config.get<string>('townhouses.chatId') ?? '';
    if (!this.chatId) {
      this.logger.warn(
        'TELEGRAM_POGORANY_CHAT_ID is not set — notifications disabled, nothing will be persisted',
      );
    }
  }

  async notifyRunResult(result: TownhousesResult): Promise<Set<string>> {
    const notified = new Set<string>();
    if (!this.chatId) return notified;

    // Nothing new or re-priced across the sources — stay silent until the weekly report.
    // A source that failed still gets a summary: it is named there, and silence would read
    // as "checked, nothing new".
    const hasChanges =
      result.isBaseline ||
      result.newListings.length > 0 ||
      result.priceChanges.length > 0 ||
      result.sources.some(s => s.failed);
    const { delivered } = await this.quiet.sendSummary({
      module: 'townhouses',
      hasChanges,
      summary: buildSummary(result),
      send: text => this.telegram.sendMessage(this.chatId, text),
    });
    if (!delivered) {
      this.logger.error('Failed to send summary — skipping per-listing notifications');
      return notified;
    }

    // Baseline: the summary states the seeded count; sending the whole catalogue would be spam.
    if (result.isBaseline) {
      this.logger.log('Baseline — skipping per-listing messages');
      return notified;
    }

    for (const [i, listing] of result.newListings.entries()) {
      const caption = buildListingCaption({
        listing,
        header: NOTIFICATION_HEADERS.new,
        index: i + 1,
        total: result.newListings.length,
      });
      if (await this.send(caption, listing.images)) notified.add(listing.uid);
    }

    for (const [i, change] of result.priceChanges.entries()) {
      const caption = buildPriceChangeCaption({
        change,
        header: NOTIFICATION_HEADERS.priceChange,
        index: i + 1,
        total: result.priceChanges.length,
      });
      if (await this.send(caption, change.listing.images)) notified.add(change.listing.uid);
    }

    return notified;
  }

  async notifyError(message: string): Promise<void> {
    if (!this.chatId) return;
    const ok = await this.telegram.sendMessage(
      this.chatId,
      `⚠️ Ошибка скрапинга таунхаусов:\n<code>${message}</code>`,
    );
    if (!ok) this.logger.warn('Failed to send error notification');
  }

  private async send(caption: string, images: string[]): Promise<boolean> {
    const photos = images.slice(0, TELEGRAM_MEDIA_GROUP_LIMIT);

    if (photos.length > 1) {
      const media: InputMediaPhoto[] = photos.map((url, i) => {
        const item: InputMediaPhoto = { type: 'photo', media: url };
        if (i === 0) {
          item.caption = truncateText(caption);
          item.parse_mode = 'HTML';
        }
        return item;
      });
      return this.telegram.sendMediaGroup(this.chatId, media);
    }

    if (photos.length === 1)
      return this.telegram.sendPhoto(this.chatId, photos[0], truncateText(caption));

    // prometr publishes no unit photos, so a text message is the normal path there.
    return this.telegram.sendMessage(this.chatId, truncateText(caption, TELEGRAM_MESSAGE_LIMIT));
  }
}
