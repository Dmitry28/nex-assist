import { registerAs } from '@nestjs/config';
import { REALT_DEFAULTS } from './constants';

export interface RealtFeedConfig {
  /** Identifier — used in snapshot filenames and Telegram headers. */
  key: string;
  /** Search URL (map view), parsed via __NEXT_DATA__. */
  url: string;
  /**
   * URL path segment used to build canonical listing links —
   * `https://realt.by/${linkPath}/object/{code}/`. Differs per property type
   * (e.g. sale-plots, sale-garage, sale-cottages, sale-dachi).
   */
  linkPath: string;
}

/**
 * Build the list of active feeds from environment variables.
 * Each feed maps to a distinct search URL, link path, and snapshot file.
 */
function buildFeeds(): RealtFeedConfig[] {
  // registerAs runs before Joi applies defaults to process.env, so we apply them explicitly here.
  return [
    {
      key: 'plots',
      url: process.env.REALT_PLOTS_URL ?? REALT_DEFAULTS.PLOTS_URL,
      linkPath: 'sale-plots',
    },
    {
      key: 'garage',
      url: process.env.REALT_GARAGE_URL ?? REALT_DEFAULTS.GARAGE_URL,
      linkPath: 'sale-garage',
    },
    {
      key: 'dom',
      url: process.env.REALT_COTTAGES_URL ?? REALT_DEFAULTS.COTTAGES_URL,
      linkPath: 'sale-cottages',
    },
    {
      key: 'dacha',
      url: process.env.REALT_DACHI_URL ?? REALT_DEFAULTS.DACHI_URL,
      linkPath: 'sale-dachi',
    },
  ];
}

/**
 * Namespaced config — access via ConfigService.get('realt.*').
 */
export default registerAs('realt', () => ({
  feeds: buildFeeds(),
  scrapeCron: process.env.REALT_SCRAPE_CRON ?? REALT_DEFAULTS.SCRAPE_CRON,
  chatId: process.env.TELEGRAM_REALT_CHAT_ID,
}));
