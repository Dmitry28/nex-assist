import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TELEGRAM_CAPTION_LIMIT, truncateText } from '../../common/utils/telegram';
import { TelegramService } from '../telegram/telegram.service';
import {
  buildNewCaption,
  buildPriceChangeCaption,
  buildSoldCaption,
  buildSummary,
} from './av-by-format';
import type { AvByFeedResult, AvByResult, RemovedAvByListing } from './dto/av-by-listing.dto';

/** What was successfully delivered to Telegram — used to gate persistence. */
export interface AvByNotifyResult {
  notifiedNew: Map<string, Set<number>>;
  notifiedSold: Map<string, Set<number>>;
  notifiedPriceChanges: Map<string, Set<number>>;
}

@Injectable()
export class AvByNotifierService {
  private readonly logger = new Logger(AvByNotifierService.name);
  private readonly chatId: string;

  constructor(
    private readonly telegram: TelegramService,
    config: ConfigService,
  ) {
    this.chatId = config.get<string>('avBy.chatId') ?? '';
  }

  async notifyRunResult(result: AvByResult): Promise<AvByNotifyResult> {
    const out: AvByNotifyResult = {
      notifiedNew: new Map(),
      notifiedSold: new Map(),
      notifiedPriceChanges: new Map(),
    };

    if (!this.chatId) {
      this.logger.warn('chatId not set — skipping Telegram notification');
      return out;
    }

    if (result.skipped) {
      this.logger.log(`Run skipped (${result.skipReason ?? 'unknown'}) — no summary sent`);
      return out;
    }

    const ok = await this.telegram.sendMessage(this.chatId, buildSummary(result, new Date()));
    if (!ok) throw new Error('Не удалось отправить сводку av.by в Telegram');

    for (const feed of result.feeds) {
      out.notifiedNew.set(feed.feedKey, new Set());
      out.notifiedSold.set(feed.feedKey, new Set());
      out.notifiedPriceChanges.set(feed.feedKey, new Set());

      // Send per-listing messages on every run, including baseline. Catalog is small
      // (a couple of VW Atlas trims) — surfacing all of them on the first prod run is
      // what we want, not a silent seed.
      await this.sendFeed(feed, out);
    }

    return out;
  }

  async notifyError(message: string): Promise<void> {
    if (!this.chatId) return;
    const ok = await this.telegram.sendMessage(
      this.chatId,
      `⚠️ av.by — ошибка скрапинга:\n<code>${message}</code>`,
    );
    if (!ok) this.logger.warn('Failed to send av.by error notification to Telegram');
  }

  private async sendFeed(feed: AvByFeedResult, out: AvByNotifyResult): Promise<void> {
    const newSet = out.notifiedNew.get(feed.feedKey)!;
    const soldSet = out.notifiedSold.get(feed.feedKey)!;
    const changeSet = out.notifiedPriceChanges.get(feed.feedKey)!;

    for (const [i, l] of feed.newListings.entries()) {
      const caption = truncateText(
        buildNewCaption(l, feed.label, i + 1, feed.newListings.length),
        TELEGRAM_CAPTION_LIMIT,
      );
      const ok = await this.sendListingMessage(caption, l.photoUrl);
      if (ok) newSet.add(l.id);
    }

    for (const [i, change] of feed.priceChanges.entries()) {
      const caption = truncateText(
        buildPriceChangeCaption(change, feed.label, i + 1, feed.priceChanges.length),
        TELEGRAM_CAPTION_LIMIT,
      );
      const ok = await this.sendListingMessage(caption, change.listing.photoUrl);
      if (ok) changeSet.add(change.listing.id);
    }

    for (const [i, removed] of feed.soldListings.entries()) {
      const caption = truncateText(
        buildSoldCaption(removed, feed.label, i + 1, feed.soldListings.length),
        TELEGRAM_CAPTION_LIMIT,
      );
      const ok = await this.sendListingMessage(caption, removed.photoUrl);
      if (ok) soldSet.add(removed.id);
    }
  }

  private async sendListingMessage(caption: string, photoUrl?: string): Promise<boolean> {
    if (photoUrl) return this.telegram.sendPhoto(this.chatId, photoUrl, caption);
    return this.telegram.sendMessage(this.chatId, caption);
  }
}

// Re-export for test convenience.
export type { RemovedAvByListing };
