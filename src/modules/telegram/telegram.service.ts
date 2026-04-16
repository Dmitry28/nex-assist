import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';
import { sleep } from '../../common/utils/sleep';
import { MAX_SEND_ATTEMPTS, SEND_INTERVAL_MS } from './constants';
import { extractRetryAfter } from './telegram.utils';

/**
 * Generic Telegram bot wrapper.
 * Handles connection setup, rate-limit retries, and exposes simple send methods.
 * Each method receives a chatId — chat routing is the caller's responsibility.
 * Import TelegramModule to use this service in any feature module.
 *
 * Dry-run mode: if TELEGRAM_TOKEN is not set, all send methods log to console
 * instead of calling the Telegram API. This lets the app run locally without credentials.
 *
 * TODO: Telegram is the only alerting channel — if the token expires or the bot is
 * blocked, errors disappear silently. Consider adding a fallback alert mechanism
 * (e.g. email, webhook, or GitHub Actions job failure) for critical scrape failures.
 */
@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private bot: TelegramBot | null = null;
  private readonly lastSentAt = new Map<string, number>();

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const token = this.config.get<string>('telegram.token');

    if (token) {
      // polling: false — we only send messages, never receive them
      this.bot = new TelegramBot(token, { polling: false });
      this.logger.log('Telegram bot initialised');
    } else {
      this.logger.warn(
        'TELEGRAM_TOKEN not set — running in dry-run mode (messages logged to console)',
      );
    }
  }

  async sendMessage(chatId: string, text: string): Promise<boolean> {
    if (!this.bot) return this.dryRun('sendMessage', chatId, text);
    await this.throttle(chatId);
    return this.withRetry(() =>
      this.bot!.sendMessage(chatId, text, { parse_mode: 'HTML' }).then(() => undefined),
    );
  }

  async sendPhoto(chatId: string, url: string, caption: string): Promise<boolean> {
    if (!this.bot) return this.dryRun('sendPhoto', chatId, caption, url);
    await this.throttle(chatId);
    const ok = await this.withRetry(() =>
      this.bot!.sendPhoto(chatId, url, { caption, parse_mode: 'HTML' }).then(() => undefined),
    );
    if (ok) return true;
    this.logger.warn('Photo send failed, falling back to text-only message');
    return this.sendMessage(chatId, caption);
  }

  async sendMediaGroup(chatId: string, media: TelegramBot.InputMediaPhoto[]): Promise<boolean> {
    if (!this.bot) return this.dryRun('sendMediaGroup', chatId, `${media.length} photos`);
    await this.throttle(chatId);
    const ok = await this.withRetry(() =>
      this.bot!.sendMediaGroup(chatId, media).then(() => undefined),
    );
    if (ok) return true;
    const caption = media.find(m => m.caption)?.caption ?? '';
    this.logger.warn('Media group failed, falling back to text-only message');
    return this.sendMessage(chatId, caption);
  }

  /** Ensures at least SEND_INTERVAL_MS between consecutive sends to the same chat. */
  private async throttle(chatId: string): Promise<void> {
    const last = this.lastSentAt.get(chatId) ?? 0;
    const elapsed = Date.now() - last;
    const wait = SEND_INTERVAL_MS - elapsed;
    if (wait > 0) {
      this.logger.debug(`Throttle chat=${chatId}: elapsed=${elapsed}ms, waiting=${wait}ms`);
      await sleep(wait);
    }
    this.lastSentAt.set(chatId, Date.now());
  }

  /**
   * Retries fn up to RATE_LIMIT_RETRIES times on Telegram 429 rate-limit responses.
   * All other errors (network, 5xx, etc.) fail immediately — only 429 triggers a retry.
   */
  private async withRetry(fn: () => Promise<void>): Promise<boolean> {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_SEND_ATTEMPTS; attempt++) {
      try {
        await fn();
        return true;
      } catch (error: unknown) {
        lastError = error;
        const retryAfter = extractRetryAfter(error);
        if (retryAfter !== null && attempt < MAX_SEND_ATTEMPTS - 1) {
          this.logger.warn(`Telegram rate limit, waiting ${retryAfter}s...`);
          await sleep(retryAfter * 1000 + 500);
        } else {
          break;
        }
      }
    }
    this.logger.error('Telegram send failed', lastError);
    return false;
  }

  private dryRun(method: string, chatId: string, content: string, extra?: string): boolean {
    this.logger.log(
      `[dry-run] ${method} → chat ${chatId}: ${content}${extra ? ` (${extra})` : ''}`,
    );
    return true;
  }
}
