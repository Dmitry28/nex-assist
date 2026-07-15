import { registerAs } from '@nestjs/config';
import { BAMPER_DEFAULTS } from './constants';

/** A single bamper.by part search to monitor (one part type for the Atlas Cross Sport). */
export interface BamperFeedConfig {
  /** Short slug used in snapshot filenames and logs. */
  key: string;
  /** Human-readable label for Telegram messages. */
  label: string;
  /** Search URL on bamper.by (already narrowed to the part, model and restyle years). */
  url: string;
}

/**
 * Namespaced config — access via ConfigService.get('bamper.*').
 *
 * bamper.by is behind Cloudflare; the parser uses Puppeteer (rebrowser-puppeteer)
 * to solve the challenge, so there is no API key — only the feed URLs and chat.
 * Add a new part by appending a feed here (key + label + URL).
 */
export default registerAs('bamper', () => ({
  feeds: [
    {
      key: 'rear-bumper',
      label: 'Задний бампер',
      url: process.env.BAMPER_REAR_BUMPER_URL ?? BAMPER_DEFAULTS.REAR_BUMPER_URL,
    },
    {
      key: 'tailgate',
      label: 'Крышка багажника',
      url: process.env.BAMPER_TAILGATE_URL ?? BAMPER_DEFAULTS.TAILGATE_URL,
    },
  ] satisfies BamperFeedConfig[],
  scrapeCron: process.env.BAMPER_SCRAPE_CRON ?? BAMPER_DEFAULTS.SCRAPE_CRON,
  // Abstract "Atlas parts" channel — not tied to bamper/bumper, so it can later
  // collect other parts for the Atlas from other sources too.
  chatId: process.env.TELEGRAM_ATLAS_PARTS_CHAT_ID,
}));
