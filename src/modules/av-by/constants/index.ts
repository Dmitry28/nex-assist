/** ScrapFly request timeout (ms). */
export const SCRAPFLY_TIMEOUT_MS = 60_000;

/** Max wall-clock time for a full scrape cycle — watchdog resets isRunning if exceeded. */
export const RUN_TIMEOUT_MS = 5 * 60 * 1000;

/** Delay between feed scrapes to avoid overlapping ScrapFly requests. */
export const INTER_FEED_DELAY_MS = 1_000;

/**
 * Snapshot file paths relative to process CWD.
 * Each feed gets its own all/removed pair; meta tracks lastRunAt for the
 * cadence guard (min-interval throttle).
 */
export const dataFile = (kind: 'all' | 'removed', feedKey: string): string =>
  `./data/av_by_${feedKey}_${kind}.json`;

export const META_FILE = './data/av_by_meta.json';

/** Section headers used in Telegram notifications. */
export const NOTIFICATION_HEADERS = {
  new: 'Новые объявления',
  sold: 'Продано',
  priceChanges: 'Изменение цены',
} as const;
