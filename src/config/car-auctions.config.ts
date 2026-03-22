import { registerAs } from '@nestjs/config';

/**
 * Namespaced config — access via ConfigService.get('carAuctions.*').
 * Defaults are defined in src/config/constants.ts and applied by Joi at startup,
 * so process.env values here are always populated (no fallbacks needed).
 */
export default registerAs('carAuctions', () => ({
  scrapeUrl: process.env.CAR_AUCTIONS_SCRAPE_URL,
  scrapeCron: process.env.CAR_AUCTIONS_SCRAPE_CRON,
  chatId: process.env.TELEGRAM_CAR_AUCTIONS_CHAT_ID,
}));
