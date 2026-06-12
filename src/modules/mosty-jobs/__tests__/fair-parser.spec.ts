import { parseFairPage } from '../fair-parser.service';
import { FAIR_PAGE_HTML } from './fixtures/fair-page';

describe('parseFairPage', () => {
  const result = parseFairPage(FAIR_PAGE_HTML);

  it('counts all fair cards for pagination control', () => {
    expect(result.all).toBe(2);
  });

  it('returns only Мостовский район fairs', () => {
    expect(result.mosty).toHaveLength(1);
    expect(result.mosty[0]).toMatchObject({
      url: 'https://e-vacancy.by/markets/5999/',
      source: 'fair',
      title: 'Электронная ярмарка вакансий Мостовского района · 18 июня 2026 г.',
    });
  });

  it('returns zero cards for a page without fairs', () => {
    expect(parseFairPage('<html><body>пусто</body></html>')).toEqual({ all: 0, mosty: [] });
  });
});
