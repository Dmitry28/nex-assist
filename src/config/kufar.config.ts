import { registerAs } from '@nestjs/config';
import { TOWNHOUSE_KEYWORDS } from '../common/utils/keyword-filter';
import { KUFAR_DEFAULTS } from './constants';

export interface KufarFeedConfig {
  key: string;
  url: string;
  /**
   * When set, only listings whose title or description contains one of these terms are
   * diffed. For categories too broad to notify on wholesale — see `keyword-filter.ts`.
   */
  titleKeywords?: string[];
}

/**
 * Build the list of active feeds from environment variables.
 * Each feed maps to a distinct search URL and snapshot file.
 * Add a new entry here (+ env var) to track a new property type.
 */
function buildFeeds(): KufarFeedConfig[] {
  // registerAs runs before Joi applies defaults to process.env, so we apply them explicitly here.
  return [
    { key: 'garazh', url: process.env.KUFAR_GARAGES_URL ?? KUFAR_DEFAULTS.GARAGES_URL },
    { key: 'uchastok', url: process.env.KUFAR_LAND_URL ?? KUFAR_DEFAULTS.LAND_URL },
    { key: 'dom', url: process.env.KUFAR_HOUSES_URL ?? KUFAR_DEFAULTS.HOUSES_URL },
    // Grodno "bridge zone" — narrower bbox, own snapshots (see KUFAR_DEFAULTS.GRODNO_*).
    {
      key: 'grodno-uchastok',
      url: process.env.KUFAR_GRODNO_LAND_URL ?? KUFAR_DEFAULTS.GRODNO_LAND_URL,
    },
    {
      key: 'grodno-dom',
      url: process.env.KUFAR_GRODNO_HOUSES_URL ?? KUFAR_DEFAULTS.GRODNO_HOUSES_URL,
    },
    // Townhouses sold as flats. Most townhouses are filed under `dom` and already covered;
    // this catches the "квартира в блокированном доме" minority the houses feeds never see.
    {
      key: 'grodno-taunhaus',
      url: process.env.KUFAR_GRODNO_TOWNHOUSE_URL ?? KUFAR_DEFAULTS.GRODNO_TOWNHOUSE_URL,
      titleKeywords: TOWNHOUSE_KEYWORDS,
    },
  ];
}

/**
 * Namespaced config — access via ConfigService.get('kufar.*').
 */
export default registerAs('kufar', () => ({
  feeds: buildFeeds(),
  scrapeCron: process.env.KUFAR_SCRAPE_CRON ?? KUFAR_DEFAULTS.SCRAPE_CRON,
  chatId: process.env.TELEGRAM_KUFAR_CHAT_ID,
}));
