/**
 * Total attempts for a single Telegram API call (1 initial + 4 retries).
 * NOTE: only Telegram 429 rate-limit errors trigger a retry with a delay;
 * all other errors (network, 5xx, etc.) fail immediately after the first attempt.
 */
export const MAX_SEND_ATTEMPTS = 5;

/**
 * Minimum interval between consecutive sends to the same chat (ms).
 * Group chats allow ~20 msg/min (1 msg/3 sec); 3100ms gives a small safety margin.
 * This covers both private (1/sec) and group (20/min) chats.
 */
export const SEND_INTERVAL_MS = 3100;
