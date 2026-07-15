import { registerAs } from '@nestjs/config';
import { BAMPER_DEFAULTS } from './constants';

/** A single bamper.by part search to monitor (one part type for one Atlas variant). */
export interface BamperFeedConfig {
  /** Short slug used in snapshot filenames and logs. */
  key: string;
  /** Car this part is for — shown in Telegram so two cars don't get confused. */
  car: string;
  /** Human-readable part label for Telegram messages. */
  label: string;
  /** Search URL on bamper.by (already narrowed to the part, model and restyle years). */
  url: string;
}

/**
 * Namespaced config — access via ConfigService.get('bamper.*').
 *
 * bamper.by is behind Cloudflare; the parser uses Puppeteer (rebrowser-puppeteer)
 * to solve the challenge, so there is no API key — only the feed URLs and chat.
 * Add a part by appending a feed (key + car + label + URL). All feeds share the
 * one "Atlas parts" channel; the `car` label keeps the two vehicles distinct.
 */
export default registerAs('bamper', () => ({
  feeds: [
    // Car 1 — Atlas Cross Sport (rear-end)
    {
      key: 'rear-bumper',
      car: 'Atlas Cross Sport',
      label: 'Задний бампер',
      url: process.env.BAMPER_REAR_BUMPER_URL ?? BAMPER_DEFAULTS.REAR_BUMPER_URL,
    },
    {
      key: 'tailgate',
      car: 'Atlas Cross Sport',
      label: 'Крышка багажника',
      url: process.env.BAMPER_TAILGATE_URL ?? BAMPER_DEFAULTS.TAILGATE_URL,
    },
    // Car 2 — Atlas (front-end)
    {
      key: 'atlas-front-bumper',
      car: 'Atlas',
      label: 'Бампер передний',
      url: process.env.BAMPER_ATLAS_FRONT_BUMPER_URL ?? BAMPER_DEFAULTS.ATLAS_FRONT_BUMPER_URL,
    },
    {
      key: 'atlas-hood',
      car: 'Atlas',
      label: 'Капот',
      url: process.env.BAMPER_ATLAS_HOOD_URL ?? BAMPER_DEFAULTS.ATLAS_HOOD_URL,
    },
    {
      key: 'atlas-headlight-left',
      car: 'Atlas',
      label: 'Фара левая',
      url: process.env.BAMPER_ATLAS_HEADLIGHT_LEFT_URL ?? BAMPER_DEFAULTS.ATLAS_HEADLIGHT_LEFT_URL,
    },
    {
      key: 'atlas-radiator-support',
      car: 'Atlas',
      label: 'Телевизор (панель радиатора)',
      url:
        process.env.BAMPER_ATLAS_RADIATOR_SUPPORT_URL ?? BAMPER_DEFAULTS.ATLAS_RADIATOR_SUPPORT_URL,
    },
  ] satisfies BamperFeedConfig[],
  scrapeCron: process.env.BAMPER_SCRAPE_CRON ?? BAMPER_DEFAULTS.SCRAPE_CRON,
  // Abstract "Atlas parts" channel — shared by both cars/all parts.
  chatId: process.env.TELEGRAM_ATLAS_PARTS_CHAT_ID,
}));
