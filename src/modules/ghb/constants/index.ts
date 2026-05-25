/** HTTP request timeout for fetching the ghb.by price list page (ms). */
export const FETCH_TIMEOUT_MS = 30_000;

/** Max HTML response size — reject anything larger to avoid memory exhaustion (2 MB). */
export const MAX_HTML_SIZE_BYTES = 2 * 1024 * 1024;

/** Max wall-clock time for a full scrape cycle — watchdog resets isRunning if exceeded (5 min). */
export const RUN_TIMEOUT_MS = 5 * 60 * 1000;

/** Snapshot file path for the ghb.by price list. */
export const DATA_FILE = './data/ghb_apartments_all.json';

/** Telegram notification section headers. */
export const NOTIFICATION_HEADERS = {
  new: '🆕 Новый объект',
} as const;
