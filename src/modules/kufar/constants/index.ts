/** Base URL for Kufar image CDN (thumbnail, 2x). */
export const IMAGE_CDN_BASE = 'https://rms.kufar.by/v1/list_thumbs_2x';

/**
 * Maximum pages to follow via cursor pagination per run — a safety cap, not a target.
 * Feeds are diffed in full (no time window), so this must exceed the largest feed:
 * at 30 ads/page the biggest one (oblast `dom`) is ~19 pages, so 40 leaves room to grow.
 */
export const MAX_PAGES = 40;

/** HTTP request timeout for fetching Kufar pages (ms). */
export const FETCH_TIMEOUT_MS = 30_000;

/** Max HTML response size — reject anything larger to avoid memory exhaustion (5 MB). */
export const MAX_HTML_SIZE_BYTES = 5 * 1024 * 1024;

/** Max wall-clock time for a full scrape cycle — watchdog resets isRunning if exceeded (15 min). */
export const RUN_TIMEOUT_MS = 15 * 60 * 1000;

/** Pause between fetching consecutive feeds to reduce load on Kufar servers (2 s). */
export const INTER_FEED_DELAY_MS = 2_000;

/**
 * Pause between consecutive pages of one feed. Kufar rate-limits sustained pagination —
 * walking the oblast `dom` feed back-to-back returned HTTP 429 on page 12. 1.5 s keeps a
 * ~19-page feed comfortably under the limit.
 */
export const INTER_PAGE_DELAY_MS = 1_500;

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
  'grodno-uchastok': 'Участки (Гродно, зона моста)',
  'grodno-dom': 'Дома/дачи/коттеджи (Гродно, зона моста)',
  'grodno-taunhaus': 'Таунхаусы в квартирах (Гродно, зона моста)',
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
