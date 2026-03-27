/** Puppeteer navigation and selector timeouts (ms). */
export const PAGE_TIMEOUT_MS = 30_000;

/** Max DOM levels to walk up when finding a card container around a lot link. */
export const CARD_WALK_DEPTH = 8;

/** Max pages to load via "Load more" pagination to prevent runaway scraping. */
export const MAX_PAGES = 10;

/** Field values considered empty — skipped when building Telegram captions. */
export const EMPTY_VALUES = new Set(['Не найдено', 'Не указано', 'N/A', '']);

/**
 * Snapshot file paths relative to process CWD.
 * Using ./data/ so the path works in both development and Docker.
 */
export const DATA_FILES = {
  all: './data/bid_cars_all.json',
  new: './data/bid_cars_new.json',
  removed: './data/bid_cars_removed.json',
} as const;

/** Section headers used in Telegram listing notifications. */
export const NOTIFICATION_HEADERS = {
  new: 'Новые авто:',
  removed: 'Снятые с продажи:',
  sold: 'Продано:',
} as const;

/**
 * How many days to keep retrying sold-price lookups for removed listings.
 * After this window the listing is considered settled without a price.
 */
export const SOLD_LOOKUP_RETENTION_DAYS = 14;

/** Max wall-clock time for a full scrape cycle — watchdog resets isRunning if exceeded (10 min). */
export const RUN_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Retry attempts when Cloudflare challenge is detected (not counting the initial try).
 * Each retry waits CLOUDFLARE_RETRY_DELAY_MS before re-launching the browser.
 */
export const CLOUDFLARE_RETRY_ATTEMPTS = 2;

/** Delay between Cloudflare retries (ms). 30s gives CF time to settle. */
export const CLOUDFLARE_RETRY_DELAY_MS = 30_000;
