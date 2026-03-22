/**
 * Max attempts for a single Telegram API call.
 * NOTE: only Telegram 429 rate-limit errors trigger a retry with a delay;
 * all other errors (network, 5xx, etc.) fail immediately after the first attempt.
 */
export const RATE_LIMIT_RETRIES = 3;
