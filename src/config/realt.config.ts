import { registerAs } from '@nestjs/config';
import { TOWNHOUSE_KEYWORDS } from '../common/utils/keyword-filter';
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
  /**
   * When set, only listings whose title or description contains one of these terms are
   * diffed. For categories too broad to notify on wholesale — see `keyword-filter.ts`.
   */
  titleKeywords?: string[];
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
    // Grodno "bridge zone" — narrower bbox, own snapshots (see REALT_DEFAULTS.GRODNO_*).
    {
      key: 'grodno-plots',
      url: process.env.REALT_GRODNO_PLOTS_URL ?? REALT_DEFAULTS.GRODNO_PLOTS_URL,
      linkPath: 'sale-plots',
    },
    {
      key: 'grodno-dom',
      url: process.env.REALT_GRODNO_COTTAGES_URL ?? REALT_DEFAULTS.GRODNO_COTTAGES_URL,
      linkPath: 'sale-cottages',
    },
    {
      key: 'grodno-dacha',
      url: process.env.REALT_GRODNO_DACHI_URL ?? REALT_DEFAULTS.GRODNO_DACHI_URL,
      linkPath: 'sale-dachi',
    },
    // Townhouses sold as flats — see the matching kufar feed.
    {
      key: 'grodno-taunhaus',
      url: process.env.REALT_GRODNO_TOWNHOUSE_URL ?? REALT_DEFAULTS.GRODNO_TOWNHOUSE_URL,
      linkPath: 'sale-flats',
      titleKeywords: TOWNHOUSE_KEYWORDS,
    },
    // Neman reservoir zone — waterfront land east of Grodno (see REALT_DEFAULTS.NEMAN_*).
    {
      key: 'neman-plots',
      url: process.env.REALT_NEMAN_PLOTS_URL ?? REALT_DEFAULTS.NEMAN_PLOTS_URL,
      linkPath: 'sale-plots',
    },
    {
      key: 'neman-dom',
      url: process.env.REALT_NEMAN_COTTAGES_URL ?? REALT_DEFAULTS.NEMAN_COTTAGES_URL,
      linkPath: 'sale-cottages',
    },
    {
      key: 'neman-dacha',
      url: process.env.REALT_NEMAN_DACHI_URL ?? REALT_DEFAULTS.NEMAN_DACHI_URL,
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
