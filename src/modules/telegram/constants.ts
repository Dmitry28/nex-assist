/**
 * Total attempts for a single Telegram API call (1 initial + 2 retries).
 * NOTE: only Telegram 429 rate-limit errors trigger a retry with a delay;
 * all other errors (network, 5xx, etc.) fail immediately after the first attempt.
 */
export const MAX_SEND_ATTEMPTS = 3;
