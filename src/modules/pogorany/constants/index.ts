/** HTTP request timeout for fetching pogorany.by pages and Tilda store API (ms). */
export const FETCH_TIMEOUT_MS = 30_000;

/** Max HTML response size — reject anything larger to avoid memory exhaustion (2 MB). */
export const MAX_HTML_SIZE_BYTES = 2 * 1024 * 1024;

/** Max wall-clock time for a full scrape cycle — watchdog resets isRunning if exceeded (10 min). */
export const RUN_TIMEOUT_MS = 10 * 60 * 1000;

/** Pause between fetching consecutive product pages to be polite to the site (ms). */
export const INTER_PRODUCT_DELAY_MS = 500;

/** Snapshot file path for the pogorany catalog. */
export const DATA_FILE = './data/pogorany_all.json';

/** Telegram notification section headers. */
export const NOTIFICATION_HEADERS = {
  new: '🆕 Новый лот',
  removed: '🚫 Снят с продажи',
  priceChange: '💸 Изменение цены',
} as const;
