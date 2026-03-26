import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sleep } from '../../common/utils/sleep';
import {
  TELEGRAM_MESSAGE_LIMIT,
  TELEGRAM_SEND_DELAY_MS,
  truncateText,
} from '../../common/utils/telegram';
import { TelegramService } from '../telegram/telegram.service';
import type { BidCarsResult, CarListing, RemovedCarListing } from './dto/car-listing.dto';
import { NOTIFICATION_HEADERS } from './constants';
import { buildCaption, buildSummary, type CaptionParams } from './bid-cars-format';

/**
 * Sends bid.cars notifications via Telegram.
 * Formats captions and delegates sending to the shared TelegramService.
 */
@Injectable()
export class BidCarsNotifierService {
  private readonly logger = new Logger(BidCarsNotifierService.name);
  private readonly chatId: string;

  constructor(
    private readonly telegram: TelegramService,
    config: ConfigService,
  ) {
    this.chatId = config.get<string>('bidCars.chatId') ?? '';
  }

  /**
   * Send the run summary and per-listing messages for new/removed/sold listings.
   * Throws if the summary fails — caller must not persist snapshot in that case.
   */
  async notifyRunResult(result: BidCarsResult): Promise<void> {
    if (!this.chatId) {
      this.logger.warn('chatId not set — skipping Telegram notification');
      return;
    }
    const { total, newListings, removedListings, soldPriceUpdates } = result;

    const ok = await this.telegram.sendMessage(
      this.chatId,
      buildSummary({
        date: new Date(),
        total,
        newCount: newListings.length,
        removedCount: removedListings.length,
        soldUpdateCount: soldPriceUpdates.length,
      }),
    );

    if (!ok) throw new Error('Не удалось отправить сводку в Telegram');

    if (newListings.length) await this.sendListings(newListings, NOTIFICATION_HEADERS.new);
    if (removedListings.length)
      await this.sendListings(removedListings, NOTIFICATION_HEADERS.removed);
    if (soldPriceUpdates.length)
      await this.sendListings(soldPriceUpdates, NOTIFICATION_HEADERS.sold);
  }

  async notifyError(message: string): Promise<void> {
    if (!this.chatId) return;
    const ok = await this.telegram.sendMessage(
      this.chatId,
      `⚠️ Ошибка скрапинга:\n<code>${message}</code>`,
    );
    if (!ok) this.logger.warn('Failed to send error notification to Telegram');
  }

  private async sendListings(
    listings: (CarListing | RemovedCarListing)[],
    header: string,
  ): Promise<void> {
    const failed: (CarListing | RemovedCarListing)[] = [];

    this.logger.log(`Sending ${listings.length} ${header}`);

    for (const [i, listing] of listings.entries()) {
      const ok = await this.sendListing({ listing, header, index: i + 1, total: listings.length });
      if (!ok) failed.push(listing);
      if (i < listings.length - 1) await sleep(TELEGRAM_SEND_DELAY_MS);
    }

    if (failed.length > 0) {
      this.logger.warn(`${failed.length} listings failed to send`);
      const list = failed.map(l => `• ${l.title ?? l.link}`).join('\n');
      await this.telegram.sendMessage(
        this.chatId,
        `⚠️ Не удалось отправить ${failed.length} объект(а):\n${list}`,
      );
    }
  }

  private async sendListing({ listing, header, index, total }: CaptionParams): Promise<boolean> {
    // bid.cars CDN blocks Telegram from fetching images, so text-only messages are used.
    // Text messages support up to 4096 chars (vs 1024 for media captions).
    const caption = truncateText(
      buildCaption({ listing, header, index, total }),
      TELEGRAM_MESSAGE_LIMIT,
    );
    return this.telegram.sendMessage(this.chatId, caption);
  }
}
