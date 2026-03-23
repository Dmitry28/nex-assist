/** Base URL for Kufar image CDN (thumbnail, 2x). */
export const IMAGE_CDN_BASE = 'https://rms.kufar.by/v1/list_thumbs_2x';

/** Maximum pages to follow via cursor pagination per run. */
export const MAX_PAGES = 10;

/** HTTP request timeout for fetching Kufar pages (ms). */
export const FETCH_TIMEOUT_MS = 30_000;

/** Max HTML response size — reject anything larger to avoid memory exhaustion (5 MB). */
export const MAX_HTML_SIZE_BYTES = 5 * 1024 * 1024;

/** Max wall-clock time for a full scrape cycle — watchdog resets isRunning if exceeded (15 min). */
export const RUN_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Only process listings whose list_time is within the last LOOKBACK_HOURS.
 * 48 h covers today + yesterday regardless of timezone offset.
 */
export const LOOKBACK_HOURS = 48;

/** Max photos per Telegram media group. */
export const MEDIA_GROUP_LIMIT = 10;

/** Field values considered empty — skipped when building Telegram captions. */
export const EMPTY_VALUES = new Set(['', 'Не указано', 'Не указан', 'Не указана', 'N/A']);

/**
 * Human-readable names for known Kufar property-type URL segments.
 * Falls back to the raw URL segment if not listed here.
 */
export const FEED_DISPLAY_NAMES: Record<string, string> = {
  garazh: 'Гаражи',
  uchastok: 'Участки',
  dom: 'Дома',
  kvartira: 'Квартиры',
  komnata: 'Комнаты',
  dacha: 'Дачи',
};

/** Snapshot file path for a given feed key. */
export const dataFile = (feedKey: string): string => `./data/kufar_${feedKey}_all.json`;

/** Telegram notification section headers. */
export const NOTIFICATION_HEADERS = {
  new: '🆕 Новые',
  priceChange: '💸 Изменение цены',
} as const;

/** Max price-change rows shown inline in the run summary message. */
export const MAX_PRICE_CHANGES_IN_SUMMARY = 8;
