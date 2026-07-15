/** Puppeteer navigation timeout (ms). */
export const PAGE_TIMEOUT_MS = 30_000;

/**
 * Pause after navigation to let the Cloudflare JS challenge solve and reload into the
 * real page before we read the DOM. Waiting on a selector instead does not work: the
 * challenge reload destroys the execution context and the wait times out even though
 * the listings are present in the settled document.
 */
export const CLOUDFLARE_SETTLE_MS = 8_000;

/**
 * Retry attempts when a Cloudflare challenge is detected (not counting the initial try).
 * Each retry relaunches the browser after CLOUDFLARE_RETRY_DELAY_MS. Same approach as BidCars.
 */
export const CLOUDFLARE_RETRY_ATTEMPTS = 2;

/** Delay between Cloudflare retries (ms). 30s gives CF time to settle. */
export const CLOUDFLARE_RETRY_DELAY_MS = 30_000;

/** Max wall-clock time for a full scrape cycle — watchdog resets isRunning if exceeded (5 min). */
export const RUN_TIMEOUT_MS = 5 * 60 * 1000;

/** Snapshot file path — current active rear-bumper listings. */
export const DATA_FILE = './data/bamper_atlas_cross_sport_all.json';

/** Telegram notification section header. */
export const NOTIFICATION_HEADER = '🆕 Задний бампер Atlas Cross Sport';
