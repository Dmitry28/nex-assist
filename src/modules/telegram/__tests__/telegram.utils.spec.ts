import {
  extractFailedMediaPosition,
  extractRetryAfter,
  isTelegramRateLimitError,
} from '../telegram.utils';

const make429 = (retryAfter: number) => ({
  response: { body: { parameters: { retry_after: retryAfter } } },
});

describe('isTelegramRateLimitError', () => {
  it('returns true for a valid 429 error shape', () =>
    expect(isTelegramRateLimitError(make429(30))).toBe(true));
  it('returns false for null', () => expect(isTelegramRateLimitError(null)).toBe(false));
  it('returns false for plain Error', () =>
    expect(isTelegramRateLimitError(new Error('fail'))).toBe(false));
  it('returns false when response is missing', () =>
    expect(isTelegramRateLimitError({})).toBe(false));
  it('returns false when body is missing', () =>
    expect(isTelegramRateLimitError({ response: {} })).toBe(false));
  it('returns false when parameters is missing', () =>
    expect(isTelegramRateLimitError({ response: { body: {} } })).toBe(false));
  it('returns false when retry_after is not a number', () =>
    expect(
      isTelegramRateLimitError({ response: { body: { parameters: { retry_after: '30' } } } }),
    ).toBe(false));
});

describe('extractRetryAfter', () => {
  it('returns the retry_after value for a valid 429', () =>
    expect(extractRetryAfter(make429(30))).toBe(30));
  it('returns null for non-429 error', () =>
    expect(extractRetryAfter(new Error('fail'))).toBeNull());
  it('returns null for null', () => expect(extractRetryAfter(null)).toBeNull());
});

describe('extractFailedMediaPosition', () => {
  it('reads the position Telegram names', () => {
    const error = new Error(
      'ETELEGRAM: 400 Bad Request: failed to send message #6 with the error message "WEBPAGE_CURL_FAILED"',
    );
    expect(extractFailedMediaPosition(error)).toBe(6);
  });

  it('returns null for any other failure', () => {
    expect(extractFailedMediaPosition(new Error('network error'))).toBeNull();
    expect(extractFailedMediaPosition('failed to send message #2')).toBeNull();
  });
});
