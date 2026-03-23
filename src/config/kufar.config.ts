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
  const candidates: Array<[string, string | undefined]> = [
    ['garazh', process.env.KUFAR_GARAGES_URL],
    ['uchastok', process.env.KUFAR_LAND_URL],
    ['dom', process.env.KUFAR_HOUSES_URL],
  ];
  return candidates
    .filter((pair): pair is [string, string] => !!pair[1])
    .map(([key, url]) => ({ key, url }));
}

/**
 * Namespaced config — access via ConfigService.get('kufar.*').
 * Defaults are defined in src/config/constants.ts and applied by Joi at startup.
 */
export default registerAs('kufar', () => ({
  feeds: buildFeeds(),
  scrapeCron: process.env.KUFAR_SCRAPE_CRON ?? KUFAR_DEFAULTS.SCRAPE_CRON,
  chatId: process.env.TELEGRAM_KUFAR_CHAT_ID,
}));
