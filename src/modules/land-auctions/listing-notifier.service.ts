import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { InputMediaPhoto } from 'node-telegram-bot-api';
import { QuietSummaryService } from '../../common/quiet-summary.service';
import {
  escapeHtml,
  TELEGRAM_MEDIA_GROUP_LIMIT,
  TELEGRAM_MESSAGE_LIMIT,
  truncateText,
} from '../../common/utils/telegram';
import { TelegramService } from '../telegram/telegram.service';
import type { LandAuctionsResult, Listing } from './dto/listing.dto';
import type { GrodnorikNotice } from './dto/grodnorik-notice.dto';
import { NOTIFICATION_HEADERS } from './constants';
import {
  buildCaption,
  buildNoticeCaption,
  buildSummary,
  type CaptionParams,
} from './listing-format';

/**
 * Sends land auction notifications via Telegram.
 * Knows the domain format (captions, emojis, summary layout) but not the Telegram API details —
 * those are handled by the shared TelegramService.
 */
@Injectable()
export class ListingNotifierService {
  private readonly logger = new Logger(ListingNotifierService.name);
  private readonly chatId: string;
  private readonly sourceUrl: string;
  private readonly grodnorikUrl: string;

  constructor(
    private readonly telegram: TelegramService,
    private readonly quiet: QuietSummaryService,
    config: ConfigService,
  ) {
    this.chatId = config.get<string>('landAuctions.chatId') ?? '';
    this.sourceUrl = config.get<string>('landAuctions.scrapeUrl') ?? '';
    this.grodnorikUrl = config.get<string>('landAuctions.grodnorikUrl') ?? '';
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
      isBaseline,
      grodnorikNotices,
      newGrodnorikNotices,
      isGrodnorikBaseline,
    } = result;

    // Nothing new, removed or sold on either source: send nothing at all, and let the weekly
    // report confirm the quiet week on Sunday.
    const hasChanges =
      isBaseline ||
      isGrodnorikBaseline ||
      newListings.length > 0 ||
      removedListings.length > 0 ||
      soldListings.length > 0 ||
      newSpecialListings.length > 0 ||
      newGrodnorikNotices.length > 0;

    const { delivered } = await this.quiet.sendSummary({
      module: 'land-auctions',
      hasChanges,
      summary: buildSummary({
        date: new Date(),
        total,
        newCount: newListings.length,
        removedCount: removedListings.length,
        soldCount: soldListings.length,
        specialCount: specialListings.length,
        newSpecialCount: newSpecialListings.length,
        isBaseline,
        sourceUrl: this.sourceUrl,
        grodnorikCount: grodnorikNotices.length,
        newGrodnorikCount: newGrodnorikNotices.length,
        isGrodnorikBaseline,
        grodnorikUrl: this.grodnorikUrl,
      }),
      send: text => this.telegram.sendMessage(this.chatId, text),
    });

    if (!delivered) throw new Error('Не удалось отправить сводку в Telegram');

    // Baseline: summary already mentions the seeded count — skip per-listing flood.
    // Each source has its own baseline flag, so seeding one never mutes the other.
    if (isBaseline) {
      this.logger.log(
        `Baseline run — skipping per-listing messages (${newListings.length} listings)`,
      );
    } else {
      if (newListings.length) await this.sendListings(newListings, NOTIFICATION_HEADERS.new);
      if (removedListings.length)
        await this.sendListings(removedListings, NOTIFICATION_HEADERS.removed);
      if (soldListings.length) await this.sendListings(soldListings, NOTIFICATION_HEADERS.sold);
      if (newSpecialListings.length)
        await this.sendListings(newSpecialListings, NOTIFICATION_HEADERS.newSpecial);
    }

    if (isGrodnorikBaseline) {
      this.logger.log(
        `Baseline run — skipping per-notice messages (${grodnorikNotices.length} notices)`,
      );
    } else if (newGrodnorikNotices.length) {
      await this.sendNotices(newGrodnorikNotices, NOTIFICATION_HEADERS.newGrodnorik);
    }
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

  /**
   * Send grodnorik.gov.by notices as plain text — the source publishes PDF/DOC files only,
   * so there is never a photo to attach.
   */
  private async sendNotices(notices: GrodnorikNotice[], header: string): Promise<void> {
    const failed: GrodnorikNotice[] = [];

    this.logger.log(`Sending ${notices.length} ${header}`);

    for (const [i, notice] of notices.entries()) {
      const caption = buildNoticeCaption({
        notice,
        header,
        index: i + 1,
        total: notices.length,
      });
      const ok = await this.telegram.sendMessage(
        this.chatId,
        truncateText(caption, TELEGRAM_MESSAGE_LIMIT),
      );
      if (!ok) failed.push(notice);
    }

    if (failed.length > 0) {
      this.logger.warn(`${failed.length} notices failed to send`);
      // Escaped for the same reason as the caption: an unescaped `&` here would make Telegram
      // reject the very message that reports what was lost.
      const list = failed.map(n => `• ${escapeHtml(n.title)}`).join('\n');
      await this.telegram.sendMessage(
        this.chatId,
        `⚠️ Не удалось отправить ${failed.length} извещение(й):\n${list}`,
      );
    }
  }

  /** Send a single listing as photo/media group or plain text if no images. */
  private async sendListing({ listing, header, index, total }: CaptionParams): Promise<boolean> {
    const rawCaption = buildCaption({ listing, header, index, total });
    const photos = (listing.images ?? []).slice(0, TELEGRAM_MEDIA_GROUP_LIMIT);
    const captionFor1024 = truncateText(rawCaption); // photo/media-group: 1024-char limit

    if (photos.length > 1) {
      const media: InputMediaPhoto[] = photos.map((url, i) => {
        const item: InputMediaPhoto = { type: 'photo', media: url };
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
