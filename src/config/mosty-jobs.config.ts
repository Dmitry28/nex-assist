import { registerAs } from '@nestjs/config';
import { MOSTY_JOBS_DEFAULTS } from './constants';

/** Namespaced config — access via ConfigService.get('mostyJobs.*'). */
export default registerAs('mostyJobs', () => ({
  gszSearchUrl: process.env.MOSTY_JOBS_GSZ_URL ?? MOSTY_JOBS_DEFAULTS.GSZ_SEARCH_URL,
  rabotaSearchUrl: process.env.MOSTY_JOBS_RABOTA_URL ?? MOSTY_JOBS_DEFAULTS.RABOTA_SEARCH_URL,
  scrapeCron: process.env.MOSTY_JOBS_SCRAPE_CRON ?? MOSTY_JOBS_DEFAULTS.SCRAPE_CRON,
  chatId: process.env.TELEGRAM_MOSTY_JOBS_CHAT_ID,
}));
