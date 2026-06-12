/** HTTP request timeout for fetching vacancy pages (ms). */
export const FETCH_TIMEOUT_MS = 30_000;

/** Max HTML response size — reject anything larger to avoid memory exhaustion (2 MB). */
export const MAX_HTML_SIZE_BYTES = 2 * 1024 * 1024;

/** Max wall-clock time for a full scrape cycle — watchdog resets isRunning if exceeded (5 min). */
export const RUN_TIMEOUT_MS = 5 * 60 * 1000;

/** Hard cap on gsz.gov.by result pages per run (the district fits in ~5 pages of 50). */
export const MAX_GSZ_PAGES = 10;

/** Hard cap on e-vacancy.by/markets/ pages per run (~4 pages of 10 fairs). */
export const MAX_FAIR_PAGES = 6;

/**
 * e-rabota.by (Evroopt career API) city ids to poll:
 * г. Мосты = 103173, агрогородок Мосты Правые = 16701557.
 * Dictionary: https://static.erabota.by/api/cities
 */
export const EVROOPT_CITY_IDS = [103173, 16701557] as const;

/** Page navigation timeout for the e-rabota.by JS-challenge flow (ms). */
export const EVROOPT_PAGE_TIMEOUT_MS = 45_000;

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
  joblab: 'joblab.by',
  evroopt: 'Евроопт (e-rabota.by)',
  crb: 'Мостовская ЦРБ',
  kufar: 'kufar.by',
  fair: 'ярмарки (e-vacancy.by)',
} as const;
