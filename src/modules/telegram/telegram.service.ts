import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';
import { sleep } from '../../common/utils/sleep';
import { MAX_SEND_ATTEMPTS } from './constants';

/**
 * Generic Telegram bot wrapper.
 * Handles connection setup, rate-limit retries, and exposes simple send methods.
 * Each method receives a chatId — chat routing is the caller's responsibility.
 * Import TelegramModule to use this service in any feature module.
 *
 * Dry-run mode: if TELEGRAM_TOKEN is not set, all send methods log to console
 * instead of calling the Telegram API. This lets the app run locally without credentials.
 */
@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private bot: TelegramBot | null = null;

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
    return this.withRetry(() =>
      this.bot!.sendMessage(chatId, text, { parse_mode: 'HTML' }).then(() => undefined),
    );
  }

  async sendPhoto(chatId: string, url: string, caption: string): Promise<boolean> {
    if (!this.bot) return this.dryRun('sendPhoto', chatId, caption, url);
    return this.withRetry(() =>
      this.bot!.sendPhoto(chatId, url, { caption, parse_mode: 'HTML' }).then(() => undefined),
    );
  }

  async sendMediaGroup(chatId: string, media: TelegramBot.InputMediaPhoto[]): Promise<boolean> {
    if (!this.bot) return this.dryRun('sendMediaGroup', chatId, `${media.length} photos`);
    return this.withRetry(() => this.bot!.sendMediaGroup(chatId, media).then(() => undefined));
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface TelegramRateLimitError {
  response: { body: { parameters: { retry_after: number } } };
}

/** Type guard for Telegram 429 rate-limit error shape. */
function isTelegramRateLimitError(error: unknown): error is TelegramRateLimitError {
  if (typeof error !== 'object' || error === null) return false;
  if (!('response' in error)) return false;
  const { response } = error as { response: unknown };
  if (typeof response !== 'object' || response === null) return false;
  if (!('body' in response)) return false;
  const { body } = response as { body: unknown };
  if (typeof body !== 'object' || body === null) return false;
  if (!('parameters' in body)) return false;
  const { parameters } = body as { parameters: unknown };
  if (typeof parameters !== 'object' || parameters === null) return false;
  return (
    'retry_after' in parameters &&
    typeof (parameters as { retry_after: unknown }).retry_after === 'number'
  );
}

/** Extract retry_after seconds from a Telegram 429 error, or null. */
const extractRetryAfter = (error: unknown): number | null => {
  if (!isTelegramRateLimitError(error)) return null;
  return error.response.body.parameters.retry_after;
};
