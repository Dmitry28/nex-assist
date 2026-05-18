import { registerAs } from '@nestjs/config';
import { POGORANY_DEFAULTS } from './constants';

/** Namespaced config — access via ConfigService.get('pogorany.*'). */
export default registerAs('pogorany', () => ({
  storeApiUrl: process.env.POGORANY_STORE_API_URL ?? POGORANY_DEFAULTS.STORE_API_URL,
  scrapeCron: process.env.POGORANY_SCRAPE_CRON ?? POGORANY_DEFAULTS.SCRAPE_CRON,
  chatId: process.env.TELEGRAM_POGORANY_CHAT_ID,
}));
