import { registerAs } from '@nestjs/config';
import { BID_CARS_DEFAULTS } from './constants';

/**
 * Namespaced config — access via ConfigService.get('bidCars.*').
 * registerAs runs before Joi applies defaults to process.env,
 * so defaults are applied explicitly here.
 */
export default registerAs('bidCars', () => {
  const scrapeUrl = process.env.BID_CARS_SCRAPE_URL ?? BID_CARS_DEFAULTS.SCRAPE_URL;
  // Derive ended/archived URLs from the active URL — same filters, different status/path.
  const endedUrl = scrapeUrl.replace('status=Active', 'status=Ended');
  const archivedUrl = endedUrl.replace('/search/results', '/search/archived/results');
  return {
    scrapeUrl,
    scrapeCron: process.env.BID_CARS_SCRAPE_CRON ?? BID_CARS_DEFAULTS.SCRAPE_CRON,
    chatId: process.env.TELEGRAM_BID_CARS_CHAT_ID,
    endedUrl,
    archivedUrl,
  };
});
