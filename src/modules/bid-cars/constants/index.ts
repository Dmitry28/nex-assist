/** Puppeteer navigation and selector timeouts (ms). */
export const PAGE_TIMEOUT_MS = 30_000;

/** Telegram max caption length in characters. */
export const TELEGRAM_CAPTION_LIMIT = 1024;

/** Delay between Telegram sends to avoid rate limiting (ms). */
export const TELEGRAM_SEND_DELAY_MS = 1000;

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
} as const;
