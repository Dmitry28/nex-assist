import { registerAs } from '@nestjs/config';
import { MOSTY_JOBS_DEFAULTS } from './constants';

/** Namespaced config — access via ConfigService.get('mostyJobs.*'). */
export default registerAs('mostyJobs', () => ({
  gszSearchUrl: process.env.MOSTY_JOBS_GSZ_URL ?? MOSTY_JOBS_DEFAULTS.GSZ_SEARCH_URL,
  rabotaSearchUrl: process.env.MOSTY_JOBS_RABOTA_URL ?? MOSTY_JOBS_DEFAULTS.RABOTA_SEARCH_URL,
  joblabRssUrl: process.env.MOSTY_JOBS_JOBLAB_URL ?? MOSTY_JOBS_DEFAULTS.JOBLAB_RSS_URL,
  kufarSearchUrl: process.env.MOSTY_JOBS_KUFAR_URL ?? MOSTY_JOBS_DEFAULTS.KUFAR_SEARCH_URL,
  evrooptApiUrl: process.env.MOSTY_JOBS_EVROOPT_URL ?? MOSTY_JOBS_DEFAULTS.EVROOPT_API_URL,
  crbUrl: process.env.MOSTY_JOBS_CRB_URL ?? MOSTY_JOBS_DEFAULTS.CRB_URL,
  fairsUrl: process.env.MOSTY_JOBS_FAIRS_URL ?? MOSTY_JOBS_DEFAULTS.FAIRS_URL,
  scrapeCron: process.env.MOSTY_JOBS_SCRAPE_CRON ?? MOSTY_JOBS_DEFAULTS.SCRAPE_CRON,
  chatId: process.env.TELEGRAM_MOSTY_JOBS_CHAT_ID,
}));
