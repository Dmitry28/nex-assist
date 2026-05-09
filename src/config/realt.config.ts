import { registerAs } from '@nestjs/config';
import { REALT_DEFAULTS } from './constants';

export interface RealtFeedConfig {
  key: string;
  url: string;
}

/**
 * Build the list of active feeds from environment variables.
 * Each feed maps to a distinct search URL and snapshot file.
 * Add a new entry here (+ env var) to track a new property type.
 */
function buildFeeds(): RealtFeedConfig[] {
  // registerAs runs before Joi applies defaults to process.env, so we apply them explicitly here.
  return [{ key: 'plots', url: process.env.REALT_PLOTS_URL ?? REALT_DEFAULTS.PLOTS_URL }];
}

/**
 * Namespaced config — access via ConfigService.get('realt.*').
 */
export default registerAs('realt', () => ({
  feeds: buildFeeds(),
  scrapeCron: process.env.REALT_SCRAPE_CRON ?? REALT_DEFAULTS.SCRAPE_CRON,
  chatId: process.env.TELEGRAM_REALT_CHAT_ID,
}));
