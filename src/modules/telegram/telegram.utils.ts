interface TelegramRateLimitError {
  response: { body: { parameters: { retry_after: number } } };
}

/** Type guard for Telegram 429 rate-limit error shape. */
export function isTelegramRateLimitError(error: unknown): error is TelegramRateLimitError {
  if (typeof error !== 'object' || error === null) return false;
  if (!('response' in error)) return false;
  const { response } = error as { response: unknown };
  if (typeof response !== 'object' || response === null) return false;
  if (!('body' in response)) return false;
  const { body } = response as { body: unknown };
  if (typeof body !== 'object' || body === null) return false;
  if (!('parameters' in body)) return false;
  const { parameters } = body as { parameters: unknown };
  if (typeof parameters !== 'object' || parameters === null) return false;
  return (
    'retry_after' in parameters &&
    typeof (parameters as { retry_after: unknown }).retry_after === 'number'
  );
}

/** Extract retry_after seconds from a Telegram 429 error, or null. */
export function extractRetryAfter(error: unknown): number | null {
  if (!isTelegramRateLimitError(error)) return null;
  return error.response.body.parameters.retry_after;
}
