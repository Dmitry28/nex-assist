/**
 * Overall request timeout for the paid rung (ms). The page is fetched with anti-bot **and**
 * rendering, which is the slowest combination the provider chain offers.
 */
export const FETCH_TIMEOUT_MS = 120_000;

/**
 * Settle time the renderer waits after load (ms). idriver.by serves a 713-byte stub that calls
 * `/inc/verification.php` and reloads itself; without the wait the renderer captures the stub.
 */
export const RENDER_WAIT_MS = 8_000;

/** Guard against a runaway body — the real catalogue page measures ~190 KB. */
export const MAX_HTML_BYTES = 5 * 1024 * 1024;

/** Proxy country for the paid rung: the site answers 403 to every non-Belarusian IP. */
export const PROXY_COUNTRY = 'by';

/** Max wall-clock time for a full scrape cycle — watchdog resets isRunning if exceeded. */
export const RUN_TIMEOUT_MS = 10 * 60 * 1000;

/** Delay between feeds, so two renders never overlap (ms). */
export const INTER_FEED_DELAY_MS = 1_000;

/**
 * How long a listing stays in the snapshot after it was last seen (days).
 *
 * Unlike bamper, a run sees only the newest page of the catalogue rather than the complete set
 * for a part, so "absent from this run" cannot mean "sold" — pruning by absence would re-notify
 * everything the next day. Entries are dropped by age instead: 180 days is far longer than an
 * offer survives on the site, so an id can only come back after the listing itself is long gone.
 */
export const RETENTION_DAYS = 180;

/** Per-feed snapshot file path, e.g. ./data/idriver_atlas-cross-sport_all.json. */
export const dataFile = (feedKey: string): string => `./data/idriver_${feedKey}_all.json`;

/** Timeout for downloading one card photo (ms) — a slow image must not stall the run. */
export const PHOTO_TIMEOUT_MS = 15_000;

/** Telegram's own limit for an uploaded photo; a larger file would be rejected anyway. */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
