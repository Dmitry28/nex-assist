import { registerAs } from '@nestjs/config';
import { LAND_AUCTIONS_DEFAULTS } from './constants';

/**
 * Namespaced config — access via ConfigService.get('landAuctions.*').
 * registerAs runs before Joi applies defaults to process.env,
 * so defaults are applied explicitly here.
 */
export default registerAs('landAuctions', () => ({
  scrapeUrl: process.env.SCRAPE_URL ?? LAND_AUCTIONS_DEFAULTS.SCRAPE_URL,
  scrapeCron: process.env.SCRAPE_CRON ?? LAND_AUCTIONS_DEFAULTS.SCRAPE_CRON,
  chatId: process.env.TELEGRAM_LAND_AUCTIONS_CHAT_ID,
}));
