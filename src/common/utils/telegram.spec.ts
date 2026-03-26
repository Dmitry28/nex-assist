import { truncateText, TELEGRAM_CAPTION_LIMIT, TELEGRAM_MESSAGE_LIMIT } from './telegram';

describe('truncateText', () => {
  it('returns text unchanged when under limit', () => {
    const text = 'short text';
    expect(truncateText(text)).toBe(text);
  });

  it('returns text unchanged when exactly at limit', () => {
    const text = 'a'.repeat(TELEGRAM_CAPTION_LIMIT);
    expect(truncateText(text)).toBe(text);
  });

  it('truncates to limit with ellipsis when over limit', () => {
    const text = 'a'.repeat(TELEGRAM_CAPTION_LIMIT + 100);
    const result = truncateText(text);
    expect(result).toHaveLength(TELEGRAM_CAPTION_LIMIT);
    expect(result.endsWith('...')).toBe(true);
  });

  it('truncates to custom limit with ellipsis', () => {
    const text = 'a'.repeat(200);
    const result = truncateText(text, 100);
    expect(result).toHaveLength(100);
    expect(result.endsWith('...')).toBe(true);
  });

  it('uses TELEGRAM_MESSAGE_LIMIT as custom limit without truncation', () => {
    const text = 'a'.repeat(TELEGRAM_CAPTION_LIMIT + 100);
    const result = truncateText(text, TELEGRAM_MESSAGE_LIMIT);
    expect(result).toBe(text); // under 4096 — no truncation
  });
});
