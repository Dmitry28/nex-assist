import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';

const SEND_RETRIES = 3;

/**
 * Generic Telegram bot wrapper.
 * Handles connection setup, rate-limit retries, and exposes simple send methods.
 * Import TelegramModule to use this service in any feature module.
 */
@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private bot!: TelegramBot;
  private chatId!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const token = this.config.getOrThrow<string>('telegram.token');
    this.chatId = this.config.getOrThrow<string>('telegram.chatId');
    // polling: false — we only send messages, never receive them
    this.bot = new TelegramBot(token, { polling: false });
  }

  async sendMessage(text: string): Promise<boolean> {
    return this.withRetry(() =>
      this.bot.sendMessage(this.chatId, text, { parse_mode: 'HTML' }).then(() => undefined),
    );
  }

  async sendPhoto(url: string, caption: string): Promise<boolean> {
    return this.withRetry(() =>
      this.bot.sendPhoto(this.chatId, url, { caption, parse_mode: 'HTML' }).then(() => undefined),
    );
  }

  async sendMediaGroup(media: TelegramBot.InputMediaPhoto[]): Promise<boolean> {
    return this.withRetry(() => this.bot.sendMediaGroup(this.chatId, media).then(() => undefined));
  }

  /**
   * Retries the given send function up to SEND_RETRIES times.
   * On a Telegram 429 rate-limit response, waits the requested retry_after delay.
   */
  private async withRetry(fn: () => Promise<void>): Promise<boolean> {
    for (let attempt = 0; attempt < SEND_RETRIES; attempt++) {
      try {
        await fn();
        return true;
      } catch (error: unknown) {
        const retryAfter = extractRetryAfter(error);
        if (retryAfter !== null && attempt < SEND_RETRIES - 1) {
          this.logger.warn(`Telegram rate limit, waiting ${retryAfter}s...`);
          await sleep(retryAfter * 1000 + 500);
        } else {
          this.logger.error('Telegram send failed', error);
          return false;
        }
      }
    }
    return false;
  }
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Extract retry_after seconds from a Telegram 429 error response, or null. */
const extractRetryAfter = (error: unknown): number | null => {
  if (typeof error !== 'object' || error === null) return null;
  const retryAfter = (error as { response?: { body?: { parameters?: { retry_after?: unknown } } } })
    .response?.body?.parameters?.retry_after;
  return typeof retryAfter === 'number' ? retryAfter : null;
};
