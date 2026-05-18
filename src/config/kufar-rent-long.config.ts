import { registerAs } from '@nestjs/config';
import { KUFAR_RENT_LONG_DEFAULTS } from './constants';

/** Namespaced config — access via ConfigService.get('kufarRentLong.*'). */
export default registerAs('kufarRentLong', () => ({
  url: process.env.KUFAR_RENT_LONG_URL ?? KUFAR_RENT_LONG_DEFAULTS.GRODNO_URL,
  scrapeCron: process.env.KUFAR_RENT_LONG_SCRAPE_CRON ?? KUFAR_RENT_LONG_DEFAULTS.SCRAPE_CRON,
  chatId: process.env.TELEGRAM_KUFAR_RENT_LONG_CHAT_ID,
}));
