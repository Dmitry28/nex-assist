import { registerAs } from '@nestjs/config';

/**
 * Namespaced config — access via ConfigService.get('bidCars.*').
 * Defaults are defined in src/config/constants.ts and applied by Joi at startup,
 * so process.env values here are always populated (no fallbacks needed).
 */
export default registerAs('bidCars', () => ({
  scrapeUrl: process.env.BID_CARS_SCRAPE_URL,
  scrapeCron: process.env.BID_CARS_SCRAPE_CRON,
  chatId: process.env.TELEGRAM_BID_CARS_CHAT_ID,
}));
