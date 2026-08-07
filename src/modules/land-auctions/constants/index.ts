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
  /** Removed listings awaiting sale price confirmation from the archive. */
  archivePending: './data/land_auctions_archive_pending.json',
  /** Auction notices published by Гродненский райисполком (second source). */
  grodnorik: './data/land_auctions_grodnorik.json',
} as const;

/** Keyword to detect special listings (Заболоть area). */
export const SPECIAL_KEYWORD = 'заболо';

/** Human-readable label for the special area — used in Telegram summary and notifications. */
export const SPECIAL_AREA_LABEL = 'Заболоть';

/** Max length for auction date strings — longer values are replaced with a fallback. */
export const MAX_AUCTION_DATE_LENGTH = 50;

/** Section headers used in Telegram listing notifications. */
export const NOTIFICATION_HEADERS = {
  new: 'Новые:',
  removed: 'Удаленные:',
  newSpecial: 'Новые в Заболоть:',
  sold: 'Продано:',
  newGrodnorik: 'Новые извещения (райисполком):',
} as const;

// ─── grodnorik.gov.by (second source) ────────────────────────────────────────

/** Human-readable label for the grodnorik.gov.by source — used in summary and notifications. */
export const GRODNORIK_SOURCE_LABEL = 'Гродненский райисполком';

/**
 * URL path marker of an auction notice file. Every notice on the page links to
 * /uploads/files/materialy/aukciony/<year>/<file>.pdf — matching the path keeps the
 * parser independent of the page's freeform WYSIWYG markup.
 */
export const GRODNORIK_NOTICE_PATH = '/materialy/aukciony/';

/** HTTP request timeout for the grodnorik.gov.by page (ms). */
export const GRODNORIK_FETCH_TIMEOUT_MS = 30_000;

/** Max HTML response size — reject anything larger to avoid memory exhaustion (2 MB). */
export const GRODNORIK_MAX_HTML_SIZE_BYTES = 2 * 1024 * 1024;

/** Archive page URL for completed auctions. */
export const ARCHIVE_URL = 'https://gcn.by/arhiv-aukczionov/';

/** Max number of archive pages to scan per run. */
export const ARCHIVE_MAX_PAGES = 3;

/** Stop checking archive after this many days since the listing was removed. */
export const ARCHIVE_PENDING_TTL_DAYS = 14;
