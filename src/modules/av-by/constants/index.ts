/** ScrapFly request timeout (ms). */
export const SCRAPFLY_TIMEOUT_MS = 120_000;

/**
 * How long ScrapFly waits (ms) after page load before capturing the DOM.
 * cars.av.by is behind the SafeLine WAF, which serves a JS challenge that must
 * execute and redirect before the real (SSR'd) page appears — this wait covers
 * that round-trip. Passed to ScrapFly as `rendering_wait` alongside render_js.
 */
export const SCRAPFLY_RENDER_WAIT_MS = 8_000;

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
