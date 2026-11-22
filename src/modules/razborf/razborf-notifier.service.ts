import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QuietSummaryService } from '../../common/quiet-summary.service';
import { TELEGRAM_MESSAGE_LIMIT, truncateText } from '../../common/utils/telegram';
import { TelegramService } from '../telegram/telegram.service';
import type { RazborfListing, RazborfResult } from './dto/razborf-listing.dto';
import { buildListingCaption, buildSummary } from './razborf-format';

/** Tracks which listings were successfully delivered — the service gates persistence on this. */
export interface RazborfNotifyResult {
  notifiedNew: Set<string>;
}

const emptyResult = (): RazborfNotifyResult => ({ notifiedNew: new Set() });

@Injectable()
export class RazborfNotifierService {
  private readonly logger = new Logger(RazborfNotifierService.name);
  private readonly chatId: string;
  private readonly modelUrl: string;

  constructor(
    private readonly telegram: TelegramService,
    private readonly quiet: QuietSummaryService,
    config: ConfigService,
  ) {
    this.chatId = config.get<string>('razborf.chatId') ?? '';
    this.modelUrl = config.get<string>('razborf.modelUrl') ?? '';
    if (!this.chatId) {
      this.logger.warn(
        'TELEGRAM_ATLAS_PARTS_CHAT_ID is not set — notifications disabled, nothing will be persisted',
      );
    }
  }

  async notifyRunResult(result: RazborfResult): Promise<RazborfNotifyResult> {
    if (!this.chatId) return emptyResult();

    // A quiet run is the expected state — the yard's restyle stock is thin.
    const hasChanges =
      result.failedCategories.length > 0 || result.isBaseline || result.newListings.length > 0;
    const { delivered } = await this.quiet.sendSummary({
      module: 'razborf',
      hasChanges,
      summary: buildSummary(result, this.modelUrl),
      send: text => this.telegram.sendMessage(this.chatId, text),
    });
    if (!delivered) {
      this.logger.error('Failed to send razborf summary — skipping all notifications');
      return emptyResult();
    }

    const notifiedNew = new Set<string>();
    const total = result.newListings.length;
    for (const [i, listing] of result.newListings.entries()) {
      const caption = truncateText(buildListingCaption({ listing, index: i + 1, total }));
      if (await this.sendListing(listing, caption)) {
        notifiedNew.add(listing.id);
        this.logger.log(`Sent id=${listing.id} (${listing.year ?? '?'}) — ${listing.title}`);
      } else {
        this.logger.warn(`Failed to send id=${listing.id} (${listing.title})`);
      }
    }
    return { notifiedNew };
  }

  async notifyError(message: string): Promise<void> {
    if (!this.chatId) return;
    const ok = await this.telegram.sendMessage(
      this.chatId,
      `⚠️ Ошибка скрапинга razborf.by:\n<code>${message}</code>`,
    );
    if (!ok) this.logger.warn('Failed to send razborf error notification');
  }

  /** Health verdicts already carry their own ⚠️/✅ wording — sent as-is. */
  async notifyHealth(message: string): Promise<void> {
    if (!this.chatId) return;
    const ok = await this.telegram.sendMessage(this.chatId, message);
    if (!ok) this.logger.warn('Failed to send razborf health notification');
  }

  /** Photo by URL; `sendPhoto` itself falls back to text if Telegram cannot fetch it. */
  private sendListing(listing: RazborfListing, caption: string): Promise<boolean> {
    return listing.photoUrl
      ? this.telegram.sendPhoto(this.chatId, listing.photoUrl, caption)
      : this.telegram.sendMessage(this.chatId, truncateText(caption, TELEGRAM_MESSAGE_LIMIT));
  }
}
