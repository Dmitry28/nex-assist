import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QuietSummaryService } from '../../common/quiet-summary.service';
import { TELEGRAM_MESSAGE_LIMIT, truncateText } from '../../common/utils/telegram';
import { TelegramService } from '../telegram/telegram.service';
import { buildListingCaption, buildSummary } from './idriver-format';
import { fetchPhoto } from './idriver-photo';
import type { IdriverFeedResult, IdriverListing, IdriverResult } from './dto/idriver-listing.dto';

/** idriver serves images as WebP only, so every uploaded photo is declared as one. */
const PHOTO_UPLOAD = { filename: 'photo.webp', contentType: 'image/webp' };

/** Tracks which listings were successfully delivered — the service gates persistence on this. */
export interface IdriverNotifyResult {
  notifiedNew: Set<string>;
}

const emptyResult = (): IdriverNotifyResult => ({ notifiedNew: new Set() });

@Injectable()
export class IdriverNotifierService {
  private readonly logger = new Logger(IdriverNotifierService.name);
  private readonly chatId: string;
  private readonly minYear: number;

  constructor(
    private readonly telegram: TelegramService,
    private readonly quiet: QuietSummaryService,
    config: ConfigService,
  ) {
    this.chatId = config.get<string>('idriver.chatId') ?? '';
    this.minYear = config.get<number>('idriver.minYear') ?? 0;
    if (!this.chatId) {
      this.logger.warn(
        'TELEGRAM_ATLAS_PARTS_CHAT_ID is not set — notifications disabled, nothing will be persisted',
      );
    }
  }

  async notifyRunResult(result: IdriverResult): Promise<IdriverNotifyResult> {
    if (!this.chatId) return emptyResult();

    // A quiet run is the expected state here — the site's restyle stock is thin — so the summary
    // is only worth sending when something actually happened: a new fitting part, a first run,
    // a failed fetch, or a page that turned over completely.
    const hasChanges =
      result.failedFeeds.length > 0 ||
      result.feeds.some(f => f.isBaseline || f.newListings.length > 0 || f.mayHaveMissed);
    const { delivered } = await this.quiet.sendSummary({
      module: 'idriver',
      hasChanges,
      summary: buildSummary(result, this.minYear),
      send: text => this.telegram.sendMessage(this.chatId, text),
    });
    if (!delivered) {
      this.logger.error('Failed to send idriver summary — skipping all notifications');
      return emptyResult();
    }
    const totalNew = result.feeds.reduce((n, f) => n + f.newListings.length, 0);
    this.logger.log(`Summary handled — ${totalNew} new across ${result.feeds.length} feed(s)`);

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
      `⚠️ Ошибка скрапинга idriver.by:\n<code>${message}</code>`,
    );
    if (!ok) this.logger.warn('Failed to send idriver error notification');
  }

  /**
   * Source-health verdicts are already worded and already carry their own ⚠️/✅, so they
   * go out as-is — routing them through notifyError announced a recovery under an
   * "Ошибка скрапинга" header.
   */
  async notifyHealth(message: string): Promise<void> {
    if (!this.chatId) return;
    const ok = await this.telegram.sendMessage(this.chatId, message);
    if (!ok) this.logger.warn('Failed to send idriver health notification');
  }

  private async sendFeedListings(feed: IdriverFeedResult, notified: Set<string>): Promise<void> {
    if (feed.newListings.length === 0) return;
    this.logger.log(`Sending ${feed.newListings.length} new "${feed.car}" listing(s)`);

    for (const [i, listing] of feed.newListings.entries()) {
      const caption = buildListingCaption({
        listing,
        car: feed.car,
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

  /**
   * The photo is downloaded and uploaded as bytes: Telegram's fetcher cannot reach
   * img*.idriver.by — see `idriver-photo.ts`. A failed download falls back to text.
   */
  private async sendListing(listing: IdriverListing, caption: string): Promise<boolean> {
    const photo = listing.photoUrl ? await fetchPhoto(listing.photoUrl) : null;
    return photo
      ? this.telegram.sendPhoto(this.chatId, photo, truncateText(caption), PHOTO_UPLOAD)
      : this.telegram.sendMessage(this.chatId, truncateText(caption, TELEGRAM_MESSAGE_LIMIT));
  }
}
