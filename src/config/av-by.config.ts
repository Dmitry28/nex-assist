import { registerAs } from '@nestjs/config';
import { AV_BY_DEFAULTS } from './constants';

/** A single av.by search filter to monitor. */
export interface AvByFeedConfig {
  /** Short slug used in snapshot filenames and Telegram captions. */
  key: string;
  /** Human-readable label for messages. */
  label: string;
  /** Filter URL on cars.av.by. */
  url: string;
}

/**
 * Namespaced config — access via ConfigService.get('avBy.*').
 *
 * av.by is protected by SafeLine WAF; requests are routed through ScrapFly's
 * Belarus residential proxy pool. Free tier = 1000 credits/mo; each request
 * costs 25 credits (residential proxy, no JS render needed — data ships in
 * the Next.js __NEXT_DATA__ blob).
 */
export default registerAs('avBy', () => ({
  // SCRAPFLY_API_KEY is read by the shared ScrapingModule (provider chain), not here.
  chatId: process.env.TELEGRAM_AV_BY_CHAT_ID,
  minRunIntervalHours: Number(
    process.env.AV_BY_MIN_RUN_INTERVAL_HOURS ?? AV_BY_DEFAULTS.MIN_RUN_INTERVAL_HOURS,
  ),
  feeds: [
    {
      key: 'atlas',
      label: 'VW Atlas',
      url: process.env.AV_BY_ATLAS_URL ?? AV_BY_DEFAULTS.ATLAS_URL,
    },
    {
      key: 'atlas_cross_sport',
      label: 'VW Atlas Cross Sport',
      url: process.env.AV_BY_ATLAS_CROSS_SPORT_URL ?? AV_BY_DEFAULTS.ATLAS_CROSS_SPORT_URL,
    },
  ] satisfies AvByFeedConfig[],
}));
