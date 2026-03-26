/** Number of concurrent Puppeteer pages for detail fetching. */
export const CONCURRENCY = 2;

/** Max wall-clock time for a full scrape cycle — watchdog resets isRunning if exceeded (10 min). */
export const RUN_TIMEOUT_MS = 10 * 60 * 1000;

/** Puppeteer navigation and selector timeouts (ms). */
export const PAGE_TIMEOUT_MS = 30_000;

/** Field values considered empty/unknown — skipped when building Telegram captions. */
export const EMPTY_VALUES = new Set([
  'Не найдено',
  'Не найден',
  'Не указана',
  'Не указан',
  'Не указаны',
  'N/A',
]);

/**
 * Snapshot file paths relative to process CWD.
 * Using ./data/ (not ./src/data/) so the path works in both development and Docker
 * where only dist/ is present at runtime.
 */
export const DATA_FILES = {
  all: './data/land_auctions_all.json',
  new: './data/land_auctions_new.json',
  removed: './data/land_auctions_removed.json',
  /** Listings matching the special area keyword (Заболоть). */
  special: './data/land_auctions_special.json',
} as const;

/** Keyword to detect special listings (Заболоть area). */
export const SPECIAL_KEYWORD = 'заболо';

/** Max length for auction date strings — longer values are replaced with a fallback. */
export const MAX_AUCTION_DATE_LENGTH = 50;

/** Section headers used in Telegram listing notifications. */
export const NOTIFICATION_HEADERS = {
  new: 'Новые:',
  removed: 'Удаленные:',
  newSpecial: 'Новые в Заболоть:',
} as const;
