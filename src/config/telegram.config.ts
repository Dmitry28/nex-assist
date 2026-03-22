import { registerAs } from '@nestjs/config';

/** Namespaced Telegram config — access via ConfigService.get('telegram.*'). */
export default registerAs('telegram', () => ({
  token: process.env.TELEGRAM_TOKEN ?? '',
  chatId: process.env.TELEGRAM_CHAT_ID ?? '',
}));
