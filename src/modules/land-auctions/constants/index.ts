/** Number of concurrent Puppeteer pages for detail fetching. */
export const CONCURRENCY = 4;

/** Telegram max photos per media group. */
export const MEDIA_GROUP_LIMIT = 10;

/** Telegram max caption length in characters. */
export const TELEGRAM_CAPTION_LIMIT = 1024;

/** Delay between Telegram sends to avoid rate limiting (ms). */
export const TELEGRAM_SEND_DELAY_MS = 1000;

/** Retries for a single Telegram send call. */
export const TELEGRAM_SEND_RETRIES = 3;

/** Field values considered empty/unknown — skipped when building Telegram captions. */
export const EMPTY_VALUES = new Set([
  'Не найдено',
  'Не найден',
  'Не указана',
  'Не указан',
  'Не указаны',
  'N/A',
]);

/** Snapshot file paths relative to project root. */
export const DATA_FILES = {
  all: './src/data/land_auctions_all.json',
  new: './src/data/land_auctions_new.json',
  removed: './src/data/land_auctions_removed.json',
  /** Listings matching the special area keyword. */
  special: './src/data/land_auctions_special.json',
} as const;

/** Keyword to detect special listings (Заболоть area). */
export const SPECIAL_KEYWORD = 'заболо';
