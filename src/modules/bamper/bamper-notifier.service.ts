import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TELEGRAM_MESSAGE_LIMIT, truncateText } from '../../common/utils/telegram';
import { TelegramService } from '../telegram/telegram.service';
import { buildListingCaption, buildSummary } from './bamper-format';
import type { BamperFeedResult, BamperListing, BamperResult } from './dto/bamper-listing.dto';

/** Tracks which listings were successfully delivered — the service gates persistence on this. */
export interface BamperNotifyResult {
  notifiedNew: Set<string>;
}

const emptyResult = (): BamperNotifyResult => ({ notifiedNew: new Set() });

@Injectable()
export class BamperNotifierService {
  private readonly logger = new Logger(BamperNotifierService.name);
  private readonly chatId: string;

  constructor(
    private readonly telegram: TelegramService,
    config: ConfigService,
  ) {
    this.chatId = config.get<string>('bamper.chatId') ?? '';
    if (!this.chatId) {
      this.logger.warn(
        'TELEGRAM_ATLAS_PARTS_CHAT_ID is not set — notifications disabled, nothing will be persisted',
      );
    }
  }

  async notifyRunResult(result: BamperResult): Promise<BamperNotifyResult> {
    if (!this.chatId) return emptyResult();

    // One summary per run covering every feed.
    const summaryOk = await this.telegram.sendMessage(this.chatId, buildSummary(result));
    if (!summaryOk) {
      this.logger.error('Failed to send bamper summary — skipping all notifications');
      return emptyResult();
    }
    const totalNew = result.feeds.reduce((n, f) => n + f.newListings.length, 0);
    this.logger.log(
      `Summary sent (1 message) — ${totalNew} new across ${result.feeds.length} feed(s)`,
    );

    // Send a card for every new listing. On the first run (empty snapshot) all current
    // listings are "new", so the whole existing inventory is delivered once.
    const notifiedNew = new Set<string>();
    for (const feed of result.feeds) {
      await this.sendFeedListings(feed, notifiedNew);
    }
    return { notifiedNew };
  }

  async notifyError(message: string): Promise<void> {
    if (!this.chatId) return;
    const ok = await this.telegram.sendMessage(
      this.chatId,
      `⚠️ Ошибка скрапинга bamper.by:\n<code>${message}</code>`,
    );
    if (!ok) this.logger.warn('Failed to send bamper error notification');
  }

  private async sendFeedListings(feed: BamperFeedResult, notified: Set<string>): Promise<void> {
    if (feed.newListings.length === 0) return;
    this.logger.log(`Sending ${feed.newListings.length} new "${feed.label}" listing(s)`);

    for (const [i, listing] of feed.newListings.entries()) {
      const caption = buildListingCaption({
        listing,
        car: feed.car,
        feedLabel: feed.label,
        index: i + 1,
        total: feed.newListings.length,
      });
      const ok = await this.sendListing(listing, caption);
      if (ok) {
        notified.add(listing.id);
        this.logger.log(
          `Sent [${feed.feedKey}] id=${listing.id} (${listing.year ?? '?'}, ${listing.photoUrl ? 'photo' : 'text'}) — ${listing.title}`,
        );
      } else {
        this.logger.warn(`Failed to send [${feed.feedKey}] id=${listing.id} (${listing.title})`);
      }
    }
  }

  private sendListing(listing: BamperListing, caption: string): Promise<boolean> {
    return listing.photoUrl
      ? this.telegram.sendPhoto(this.chatId, listing.photoUrl, truncateText(caption))
      : this.telegram.sendMessage(this.chatId, truncateText(caption, TELEGRAM_MESSAGE_LIMIT));
  }
}
