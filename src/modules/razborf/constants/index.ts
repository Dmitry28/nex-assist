/** Timeout for one page request (ms). The site is plain server-rendered HTML. */
export const FETCH_TIMEOUT_MS = 30_000;

/** Guard against a runaway body — real pages measure 20-55 KB. */
export const MAX_HTML_BYTES = 5 * 1024 * 1024;

/** Max wall-clock time for a full scrape cycle — watchdog resets isRunning if exceeded. */
export const RUN_TIMEOUT_MS = 5 * 60 * 1000;

/** Delay between category page requests (ms) — one small yard's server, be polite. */
export const INTER_REQUEST_DELAY_MS = 1_000;

/**
 * How long a listing stays in the snapshot after it was last seen (days). A category page is the
 * whole stock for that part, but categories appear and vanish with the stock, so "absent" cannot
 * be told from "category gone" — entries age out instead of being pruned by absence.
 */
export const RETENTION_DAYS = 180;

/** Snapshot file path, e.g. ./data/razborf_all.json. */
export const SNAPSHOT_FILE = './data/razborf_all.json';
