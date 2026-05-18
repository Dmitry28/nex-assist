import { registerAs } from '@nestjs/config';
import { KUFAR_RENT_FLAT_DEFAULTS } from './constants';

/** Namespaced config — access via ConfigService.get('kufarRentFlat.*'). */
export default registerAs('kufarRentFlat', () => ({
  url: process.env.KUFAR_RENT_FLAT_URL ?? KUFAR_RENT_FLAT_DEFAULTS.GRODNO_URL,
  scrapeCron: process.env.KUFAR_RENT_FLAT_SCRAPE_CRON ?? KUFAR_RENT_FLAT_DEFAULTS.SCRAPE_CRON,
  chatId: process.env.TELEGRAM_KUFAR_RENT_FLAT_CHAT_ID,
}));
