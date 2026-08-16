/** HTTP request timeout for fetching vacancy pages (ms). */
export const FETCH_TIMEOUT_MS = 30_000;

/** Max HTML response size — reject anything larger to avoid memory exhaustion (2 MB). */
export const MAX_HTML_SIZE_BYTES = 2 * 1024 * 1024;

/**
 * Max wall-clock time for a full scrape cycle — watchdog resets isRunning if exceeded.
 * 10 min: the scrape itself takes ~1.5, and NOTIFY_BUDGET_MS lets a recovering source spend
 * another four sending what it found. Five minutes used to fire mid-send in exactly that case.
 */
export const RUN_TIMEOUT_MS = 10 * 60 * 1000;

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
 * How long a run may spend sending per-vacancy messages.
 *
 * This used to be a flat cap of 20 messages, which was mistaken for a Telegram limit — it is
 * not. TelegramService already paces sends 3.1s apart, under the ~20/min a group chat allows,
 * so the only thing a count protected was run duration. It measured that badly: when gsz came
 * back from four days down with 65 new vacancies, 45 of them were held for later runs — two to
 * three days of drip for messages that would have taken three and a half minutes to send.
 *
 * A time budget bounds what actually matters. At 3.1s a message, four minutes is ~77 vacancies:
 * comfortably more than a source returning from an outage, and still a stop for the pathological
 * case. Whatever does not fit is not persisted, so it goes out on the next run as before.
 */
export const NOTIFY_BUDGET_MS = 4 * 60 * 1000;

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
