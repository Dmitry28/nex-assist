import { registerAs } from '@nestjs/config';
import { IDRIVER_DEFAULTS } from './constants';

/** One idriver.by car catalogue to monitor (all parts of one model, newest first). */
export interface IdriverFeedConfig {
  /** Short slug used in the snapshot filename and logs. */
  key: string;
  /** Car this catalogue belongs to — shown in Telegram, since the channel carries two cars. */
  car: string;
  /** Model catalogue URL, sorted by `sorter=fresh`. */
  url: string;
}

/**
 * Namespaced config — access via ConfigService.get('idriver.*').
 *
 * idriver.by is a second source for the same Atlas parts as the bamper.by module, and posts to
 * the same "Atlas parts" channel. Two things make it different, and shape this config:
 *
 * 1. The site answers 403 to every non-Belarusian IP and hides its content behind a JS gate, so
 *    both free rungs of the fetch ladder are hopeless and every run costs a rendered
 *    anti-bot request (~25 ZenRows credits). One feed per car, not one per part, is what keeps
 *    that affordable.
 * 2. Its URLs carry no year filter, so the 2023+ window lives in `minYear` and is applied
 *    after parsing.
 *
 * Only the Atlas Cross Sport is listed: idriver's `atlas` model covers 2017-2020 donors only,
 * which cannot fit the restyle the owner drives, so a feed for it would cost credits to
 * deliver nothing.
 */
export default registerAs('idriver', () => ({
  feeds: [
    {
      key: 'atlas-cross-sport',
      car: 'Atlas Cross Sport',
      url: process.env.IDRIVER_ATLAS_CROSS_SPORT_URL ?? IDRIVER_DEFAULTS.ATLAS_CROSS_SPORT_URL,
    },
  ] satisfies IdriverFeedConfig[],
  minYear: Number(process.env.IDRIVER_MIN_YEAR ?? IDRIVER_DEFAULTS.MIN_YEAR),
  scrapeCron: process.env.IDRIVER_SCRAPE_CRON ?? IDRIVER_DEFAULTS.SCRAPE_CRON,
  // Same abstract "Atlas parts" channel as bamper.by — one car, one place to look.
  chatId: process.env.TELEGRAM_ATLAS_PARTS_CHAT_ID,
}));
