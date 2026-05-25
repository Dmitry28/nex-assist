import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TELEGRAM_MESSAGE_LIMIT, truncateText } from '../../common/utils/telegram';
import { TelegramService } from '../telegram/telegram.service';
import { NOTIFICATION_HEADERS } from './constants';
import type { GhbListing, GhbResult } from './dto/ghb-listing.dto';
import { buildListingCaption, buildSummary } from './ghb-format';

/** Tracks which listings were successfully delivered — service uses this to gate persistence. */
export interface GhbNotifyResult {
  notifiedNew: Set<string>;
}

const emptyResult = (): GhbNotifyResult => ({ notifiedNew: new Set() });

@Injectable()
export class GhbNotifierService {
  private readonly logger = new Logger(GhbNotifierService.name);
  private readonly chatId: string;

  constructor(
    private readonly telegram: TelegramService,
    config: ConfigService,
  ) {
    this.chatId = config.get<string>('ghb.chatId') ?? '';
    if (!this.chatId) {
      this.logger.warn(
        'TELEGRAM_GHB_CHAT_ID is not set — notifications disabled, nothing will be persisted',
      );
    }
  }

  async notifyRunResult(result: GhbResult): Promise<GhbNotifyResult> {
    if (!this.chatId) return emptyResult();

    const summaryOk = await this.telegram.sendMessage(this.chatId, buildSummary(result));
    if (!summaryOk) {
      this.logger.error('Failed to send ghb.by summary — skipping all notifications');
      return emptyResult();
    }
    this.logger.log('Summary sent to Telegram');

    // Baseline run: snapshot is seeded silently — only the summary above is sent.
    if (result.isBaseline) return emptyResult();

    const notifiedNew = await this.sendListings(result.newListings);
    return { notifiedNew };
  }

  async notifyError(message: string): Promise<void> {
    if (!this.chatId) return;
    const ok = await this.telegram.sendMessage(
      this.chatId,
      `⚠️ Ошибка скрапинга ghb.by:\n<code>${message}</code>`,
    );
    if (!ok) this.logger.warn('Failed to send ghb.by error notification');
  }

  private async sendListings(listings: GhbListing[]): Promise<Set<string>> {
    const notified = new Set<string>();
    if (listings.length === 0) return notified;

    this.logger.log(`Sending ${listings.length} new listing(s)`);

    for (const [i, listing] of listings.entries()) {
      const caption = buildListingCaption({
        listing,
        header: NOTIFICATION_HEADERS.new,
        index: i + 1,
        total: listings.length,
      });
      const ok = await this.telegram.sendMessage(
        this.chatId,
        truncateText(caption, TELEGRAM_MESSAGE_LIMIT),
      );
      if (ok) notified.add(listing.url);
      else this.logger.warn(`Failed to send listing url=${listing.url}`);
    }

    return notified;
  }
}
