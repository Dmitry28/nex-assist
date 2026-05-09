/** HTTP request timeout for fetching realt.by pages (ms). */
export const FETCH_TIMEOUT_MS = 30_000;

/** Max HTML response size — reject anything larger to avoid memory exhaustion (5 MB). */
export const MAX_HTML_SIZE_BYTES = 5 * 1024 * 1024;

/** Max wall-clock time for a full scrape cycle — watchdog resets isRunning if exceeded (15 min). */
export const RUN_TIMEOUT_MS = 15 * 60 * 1000;

/** Pause between fetching consecutive feeds to reduce load on realt.by servers (2 s). */
export const INTER_FEED_DELAY_MS = 2_000;

/**
 * Maximum pages to follow per run. realt.by uses ?page=N pagination with pageSize=30.
 * Effective cap; pagination naturally stops when totalCount is exhausted.
 */
export const MAX_PAGES = 20;

/**
 * Only process listings whose `updatedAt` is within the last LOOKBACK_HOURS.
 * realt.by map view returns ALL active listings (incl. years-old ones) — without this
 * filter we'd diff hundreds of stale ads and never catch what actually changed.
 * 48 h covers today + yesterday regardless of timezone offset.
 */
export const LOOKBACK_HOURS = 48;

/** Field values considered empty — skipped when building Telegram captions. */
export const EMPTY_VALUES = new Set(['', 'Не указано', 'Не указан', 'Не указана', 'N/A']);

/**
 * Human-readable names for known realt.by feed keys.
 * Falls back to the raw key if not listed here.
 */
export const FEED_DISPLAY_NAMES: Record<string, string> = {
  plots: 'Участки',
  garage: 'Гаражи',
  dom: 'Дома',
  dacha: 'Дачи',
};

/** Snapshot file path for a given feed key. */
export const dataFile = (feedKey: string): string => `./data/realt_${feedKey}_all.json`;

/** Build a canonical realt.by listing URL from the numeric `code` id and per-feed path. */
export const listingLink = (linkPath: string, code: number): string =>
  `https://realt.by/${linkPath}/object/${code}/`;

/** Telegram notification section headers. */
export const NOTIFICATION_HEADERS = {
  new: '🆕 Новые',
  priceChange: '💸 Изменение цены',
} as const;

/** Max price-change rows shown inline in the run summary message. */
export const MAX_PRICE_CHANGES_IN_SUMMARY = 8;

/**
 * realt.by `priceRates` currency codes (ISO 4217 numeric).
 * Source: realt.by __NEXT_DATA__ object.priceRates map.
 */
export const CURRENCY_USD = '840';
export const CURRENCY_BYN = '933';
