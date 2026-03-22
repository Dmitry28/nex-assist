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

/** Field values considered empty/unknown. */
export const EMPTY_VALUES = new Set([
  'Не найдено',
  'Не найден',
  'Не указана',
  'Не указан',
  'Не указаны',
  'N/A',
]);

/** Data file paths relative to project root. */
export const DATA_FILES = {
  all: './src/data/all_items.json',
  new: './src/data/new_items.json',
  removed: './src/data/removed_items.json',
  special: './src/data/zabolot_items.json',
} as const;

/** Keyword to detect special listings (Заболоть area). */
export const SPECIAL_KEYWORD = 'заболо';
