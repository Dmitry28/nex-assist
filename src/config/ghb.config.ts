import { registerAs } from '@nestjs/config';
import { GHB_DEFAULTS } from './constants';

/** Namespaced config — access via ConfigService.get('ghb.*'). */
export default registerAs('ghb', () => ({
  priceListUrl: process.env.GHB_PRICE_LIST_URL ?? GHB_DEFAULTS.PRICE_LIST_URL,
  scrapeCron: process.env.GHB_SCRAPE_CRON ?? GHB_DEFAULTS.SCRAPE_CRON,
  chatId: process.env.TELEGRAM_GHB_CHAT_ID,
}));
