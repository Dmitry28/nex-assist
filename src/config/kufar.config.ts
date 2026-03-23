import { registerAs } from '@nestjs/config';
import { KUFAR_DEFAULTS } from './constants';

export interface KufarFeedConfig {
  key: string;
  url: string;
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
