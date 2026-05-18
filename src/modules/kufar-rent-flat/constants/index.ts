/** HTTP request timeout for fetching travel.kufar.by pages (ms). */
export const FETCH_TIMEOUT_MS = 30_000;

/** Max HTML response size — reject anything larger to avoid memory exhaustion (5 MB). */
export const MAX_HTML_SIZE_BYTES = 5 * 1024 * 1024;

/** Max wall-clock time for a full scrape cycle — watchdog resets isRunning if exceeded (5 min). */
export const RUN_TIMEOUT_MS = 5 * 60 * 1000;

/** Snapshot file path for the kufar-rent-flat catalog. */
export const DATA_FILE = './data/kufar_rent_flat_all.json';

/** Telegram notification section header. */
export const NOTIFICATION_HEADERS = {
  new: '🆕 Новое жильё',
} as const;
