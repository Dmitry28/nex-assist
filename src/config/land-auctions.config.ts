import { registerAs } from '@nestjs/config';

/**
 * Namespaced config — access via ConfigService.get('landAuctions.*').
 * Defaults are defined in src/config/constants.ts and applied by Joi at startup,
 * so process.env values here are always populated (no fallbacks needed).
 */
export default registerAs('landAuctions', () => ({
  scrapeUrl: process.env.SCRAPE_URL,
  scrapeCron: process.env.SCRAPE_CRON,
}));
