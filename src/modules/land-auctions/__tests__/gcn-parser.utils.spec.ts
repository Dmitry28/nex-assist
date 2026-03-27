import { normalizePrice, parseDateFromAuctionDate } from '../gcn-parser.utils';

describe('parseDateFromAuctionDate', () => {
  it('returns undefined for undefined input', () =>
    expect(parseDateFromAuctionDate(undefined)).toBeUndefined());
  it('returns undefined for empty string', () =>
    expect(parseDateFromAuctionDate('')).toBeUndefined());
  it('returns undefined when no recognisable date', () =>
    expect(parseDateFromAuctionDate('уточняется')).toBeUndefined());

  it('extracts numeric date from standard phrase', () =>
    expect(parseDateFromAuctionDate('Аукцион состоится 24.03.2026')).toBe('24.03.2026'));
  it('extracts numeric date when no phrase prefix', () =>
    expect(parseDateFromAuctionDate('24.03.2026')).toBe('24.03.2026'));

  it('converts month-name format', () =>
    expect(parseDateFromAuctionDate('Аукцион состоится 24 марта 2026 в 12:00')).toBe('24.03.2026'));
  it('converts single-digit day with month name', () =>
    expect(parseDateFromAuctionDate('5 апреля 2026')).toBe('05.04.2026'));
  it('handles all months', () => {
    const cases: [string, string][] = [
      ['1 января 2026', '01.01.2026'],
      ['2 февраля 2026', '02.02.2026'],
      ['3 марта 2026', '03.03.2026'],
      ['4 апреля 2026', '04.04.2026'],
      ['5 мая 2026', '05.05.2026'],
      ['6 июня 2026', '06.06.2026'],
      ['7 июля 2026', '07.07.2026'],
      ['8 августа 2026', '08.08.2026'],
      ['9 сентября 2026', '09.09.2026'],
      ['10 октября 2026', '10.10.2026'],
      ['11 ноября 2026', '11.11.2026'],
      ['12 декабря 2026', '12.12.2026'],
    ];
    for (const [input, expected] of cases) {
      expect(parseDateFromAuctionDate(input)).toBe(expected);
    }
  });
});

describe('normalizePrice', () => {
  it('removes руб. suffix and whitespace', () =>
    expect(normalizePrice('19 370,61 руб.')).toBe('19370,61'));
  it('removes руб without dot', () => expect(normalizePrice('19 370 руб')).toBe('19370'));
  it('is case-insensitive for РУБ', () => expect(normalizePrice('5000 РУБ.')).toBe('5000'));
  it('handles value with no suffix', () => expect(normalizePrice('19370,61')).toBe('19370,61'));
  it('collapses internal spaces', () => expect(normalizePrice('1 000 000 руб.')).toBe('1000000'));
});
