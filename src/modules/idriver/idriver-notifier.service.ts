import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QuietSummaryService } from '../../common/quiet-summary.service';
import { TELEGRAM_MESSAGE_LIMIT, truncateText } from '../../common/utils/telegram';
import { TelegramService } from '../telegram/telegram.service';
import { buildListingCaption, buildSummary } from './idriver-format';
import type { IdriverFeedResult, IdriverResult } from './dto/idriver-listing.dto';

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
      // Text only: see the parser for why these cards carry no photo.
      const ok = await this.telegram.sendMessage(
        this.chatId,
        truncateText(caption, TELEGRAM_MESSAGE_LIMIT),
      );
      if (ok) {
        notified.add(listing.id);
        this.logger.log(
          `Sent [${feed.feedKey}] id=${listing.id} (${listing.year ?? '?'}) — ${listing.title}`,
        );
      } else {
        this.logger.warn(`Failed to send [${feed.feedKey}] id=${listing.id} (${listing.title})`);
      }
    }
  }
}
