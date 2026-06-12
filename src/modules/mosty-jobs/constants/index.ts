/** HTTP request timeout for fetching vacancy pages (ms). */
export const FETCH_TIMEOUT_MS = 30_000;

/** Max HTML response size — reject anything larger to avoid memory exhaustion (2 MB). */
export const MAX_HTML_SIZE_BYTES = 2 * 1024 * 1024;

/** Max wall-clock time for a full scrape cycle — watchdog resets isRunning if exceeded (5 min). */
export const RUN_TIMEOUT_MS = 5 * 60 * 1000;

/** Hard cap on gsz.gov.by result pages per run (the district fits in ~5 pages of 50). */
export const MAX_GSZ_PAGES = 10;

/**
 * Max per-vacancy Telegram messages per run. Protects against floods after a
 * partial baseline (e.g. one source failed on the first run). Undelivered
 * vacancies are not persisted, so the rest drip out on subsequent runs.
 */
export const MAX_NOTIFICATIONS_PER_RUN = 20;

/** Snapshot file path for Мостовский район vacancies. */
export const DATA_FILE = './data/mosty_jobs.json';

/**
 * Drop snapshot entries not seen for this many days. Job boards have high
 * turnover — without pruning the committed snapshot grows without bound.
 * A vacancy reposted after this long is worth re-notifying anyway.
 */
export const SNAPSHOT_RETENTION_DAYS = 90;

/** Telegram notification section headers. */
export const NOTIFICATION_HEADERS = {
  new: '🆕 Новая вакансия',
} as const;

/** Human-readable source labels for Telegram messages. */
export const SOURCE_LABELS = {
  gsz: 'gsz.gov.by',
  rabota: 'rabota.by',
} as const;
