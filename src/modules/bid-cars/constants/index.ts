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
