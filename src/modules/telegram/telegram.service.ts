import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';
import { sleep } from '../../common/utils/sleep';
import { SEND_RETRIES } from './constants';

/**
 * Generic Telegram bot wrapper.
 * Handles connection setup, rate-limit retries, and exposes simple send methods.
 * Import TelegramModule to use this service in any feature module.
 *
 * Dry-run mode: if TELEGRAM_TOKEN / TELEGRAM_CHAT_ID are not set,
 * all send methods log to console instead of calling the Telegram API.
 * This lets the app run locally without credentials.
 */
@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private bot: TelegramBot | null = null;
  private chatId = '';

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const token = this.config.get<string>('telegram.token');
    const chatId = this.config.get<string>('telegram.chatId');

    if (token && chatId) {
      // polling: false — we only send messages, never receive them
      this.bot = new TelegramBot(token, { polling: false });
      this.chatId = chatId;
      this.logger.log('Telegram bot initialised');
    } else {
      this.logger.warn(
        'TELEGRAM_TOKEN or TELEGRAM_CHAT_ID not set — running in dry-run mode (messages logged to console)',
      );
    }
  }

  async sendMessage(text: string): Promise<boolean> {
    if (!this.bot) return this.dryRun('sendMessage', text);
    return this.withRetry(() =>
      this.bot!.sendMessage(this.chatId, text, { parse_mode: 'HTML' }).then(() => undefined),
    );
  }

  async sendPhoto(url: string, caption: string): Promise<boolean> {
    if (!this.bot) return this.dryRun('sendPhoto', caption, url);
    return this.withRetry(() =>
      this.bot!.sendPhoto(this.chatId, url, { caption, parse_mode: 'HTML' }).then(() => undefined),
    );
  }

  async sendMediaGroup(media: TelegramBot.InputMediaPhoto[]): Promise<boolean> {
    if (!this.bot) return this.dryRun('sendMediaGroup', `${media.length} photos`);
    return this.withRetry(() => this.bot!.sendMediaGroup(this.chatId, media).then(() => undefined));
  }

  /**
   * Retries fn up to SEND_RETRIES times.
   * On a Telegram 429 rate-limit response, waits the requested retry_after delay.
   */
  private async withRetry(fn: () => Promise<void>): Promise<boolean> {
    let lastError: unknown;
    for (let attempt = 0; attempt < SEND_RETRIES; attempt++) {
      try {
        await fn();
        return true;
      } catch (error: unknown) {
        lastError = error;
        const retryAfter = extractRetryAfter(error);
        if (retryAfter !== null && attempt < SEND_RETRIES - 1) {
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

  private dryRun(method: string, content: string, extra?: string): boolean {
    this.logger.log(`[dry-run] ${method}: ${content}${extra ? ` (${extra})` : ''}`);
    return true;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface TelegramRateLimitError {
  response: { body: { parameters: { retry_after: number } } };
}

/** Type guard for Telegram 429 rate-limit error shape. */
function isTelegramRateLimitError(error: unknown): error is TelegramRateLimitError {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as Record<string, unknown>;
  const body = (e.response as Record<string, unknown> | undefined)?.body as
    | Record<string, unknown>
    | undefined;
  const params = body?.parameters as Record<string, unknown> | undefined;
  return typeof params?.retry_after === 'number';
}

/** Extract retry_after seconds from a Telegram 429 error, or null. */
const extractRetryAfter = (error: unknown): number | null => {
  if (!isTelegramRateLimitError(error)) return null;
  return error.response.body.parameters.retry_after;
};
