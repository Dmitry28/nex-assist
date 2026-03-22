import { registerAs } from '@nestjs/config';

/**
 * Namespaced Telegram config — access via ConfigService.get('telegram.*').
 * NOTE: token and chatId are optional — if absent, TelegramService runs in dry-run mode.
 */
export default registerAs('telegram', () => ({
  token: process.env.TELEGRAM_TOKEN,
  chatId: process.env.TELEGRAM_CHAT_ID,
}));
