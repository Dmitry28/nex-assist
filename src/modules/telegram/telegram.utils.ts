import type { InputMediaPhoto } from 'node-telegram-bot-api';

interface TelegramRateLimitError {
  response: { body: { parameters: { retry_after: number } } };
}

/** Type guard for Telegram 429 rate-limit error shape. */
export function isTelegramRateLimitError(error: unknown): error is TelegramRateLimitError {
  if (typeof error !== 'object' || error === null) return false;
  if (!('response' in error)) return false;
  const { response } = error;
  if (typeof response !== 'object' || response === null) return false;
  if (!('body' in response)) return false;
  const { body } = response;
  if (typeof body !== 'object' || body === null) return false;
  if (!('parameters' in body)) return false;
  const { parameters } = body;
  if (typeof parameters !== 'object' || parameters === null) return false;
  return 'retry_after' in parameters && typeof parameters.retry_after === 'number';
}

/** Extract retry_after seconds from a Telegram 429 error, or null. */
export function extractRetryAfter(error: unknown): number | null {
  if (!isTelegramRateLimitError(error)) return null;
  return error.response.body.parameters.retry_after;
}

/**
 * Position (1-based) of the media item Telegram refused in a sendMediaGroup call, or null.
 * Telegram names it in the message: `failed to send message #6 with the error message
 * "WEBPAGE_CURL_FAILED"` — it could not fetch that one URL, the rest of the group was fine.
 */
export function extractFailedMediaPosition(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const match = error.message.match(/failed to send message #(\d+) with the error message/);
  return match ? Number(match[1]) : null;
}

/** The group without the item at `index`; the caption moves to the new first item if it was there. */
export function withoutMediaAt(media: InputMediaPhoto[], index: number): InputMediaPhoto[] {
  const dropped = media[index];
  const rest = media.filter((_, i) => i !== index);
  if (!dropped?.caption || rest.length === 0) return rest;
  const [first, ...others] = rest;
  return [{ ...first, caption: dropped.caption, parse_mode: dropped.parse_mode }, ...others];
}
