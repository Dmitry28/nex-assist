import { truncateCaption, TELEGRAM_CAPTION_LIMIT } from './telegram';

describe('truncateCaption', () => {
  it('returns text unchanged when under limit', () => {
    const text = 'short text';
    expect(truncateCaption(text)).toBe(text);
  });

  it('returns text unchanged when exactly at limit', () => {
    const text = 'a'.repeat(TELEGRAM_CAPTION_LIMIT);
    expect(truncateCaption(text)).toBe(text);
  });

  it('truncates to limit with ellipsis when over limit', () => {
    const text = 'a'.repeat(TELEGRAM_CAPTION_LIMIT + 100);
    const result = truncateCaption(text);
    expect(result).toHaveLength(TELEGRAM_CAPTION_LIMIT);
    expect(result.endsWith('...')).toBe(true);
  });
});
