import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TELEGRAM_MESSAGE_LIMIT, truncateText } from '../../common/utils/telegram';
import { TelegramService } from '../telegram/telegram.service';
import { buildListingCaption, buildSummary } from './bamper-format';
import type { BamperListing, BamperResult } from './dto/bamper-listing.dto';

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

    const summaryOk = await this.telegram.sendMessage(this.chatId, buildSummary(result));
    if (!summaryOk) {
      this.logger.error('Failed to send bamper summary — skipping all notifications');
      return emptyResult();
    }
    // One summary per run by design. Log which kind so runs are auditable from logs
    // alone (no need to inspect the chat).
    this.logger.log(
      `Summary sent (1 message) — ${result.isBaseline ? 'baseline' : `${result.newListings.length} new`}`,
    );

    // Baseline is persisted unconditionally by the service, so no per-listing spam on first run.
    const notifiedNew = result.isBaseline
      ? new Set<string>()
      : await this.sendListings(result.newListings);

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

  private async sendListings(listings: BamperListing[]): Promise<Set<string>> {
    const notified = new Set<string>();
    if (listings.length === 0) return notified;

    this.logger.log(`Sending ${listings.length} new listing(s)`);
    for (const [i, listing] of listings.entries()) {
      const caption = buildListingCaption({ listing, index: i + 1, total: listings.length });
      const ok = listing.photoUrl
        ? await this.telegram.sendPhoto(this.chatId, listing.photoUrl, truncateText(caption))
        : await this.telegram.sendMessage(
            this.chatId,
            truncateText(caption, TELEGRAM_MESSAGE_LIMIT),
          );
      if (ok) {
        notified.add(listing.id);
        this.logger.log(
          `Sent listing id=${listing.id} (${listing.year ?? '?'}, ${listing.photoUrl ? 'photo' : 'text'}) — ${listing.title}`,
        );
      } else {
        this.logger.warn(`Failed to send listing id=${listing.id} (${listing.title})`);
      }
    }
    return notified;
  }
}
