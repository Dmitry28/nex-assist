import { registerAs } from '@nestjs/config';

/**
 * Namespaced Telegram config — access via ConfigService.get('telegram.*').
 * Only the bot token lives here — chat IDs are per-module (e.g. landAuctions.chatId).
 * If token is absent, TelegramService runs in dry-run mode.
 */
export default registerAs('telegram', () => ({
  token: process.env.TELEGRAM_TOKEN,
}));
