import { parseCrbPage } from '../crb-parser.service';
import { CRB_PAGE_HTML } from './fixtures/crb-page';

const PAGE_URL = 'https://mostycrb.by/company/vakansii/';

describe('parseCrbPage', () => {
  const vacancies = parseCrbPage(CRB_PAGE_HTML, PAGE_URL);

  it('parses all list items', () => {
    expect(vacancies).toHaveLength(8);
  });

  it('extracts the title with normalized whitespace and entities', () => {
    expect(vacancies?.[0].title).toBe('Врач клинической лабораторной диагностики');
    expect(vacancies?.[4].title).toBe('Врач общей практики Рогозницкой амбулатории общей практики');
  });

  it('builds a stable fragment URL as the diff key', () => {
    expect(vacancies?.[0].url).toBe(
      `${PAGE_URL}#${encodeURIComponent('врач-клинической-лабораторной-диагностики')}`,
    );
    expect(new Set(vacancies?.map(v => v.url)).size).toBe(8);
  });

  it('sets the gsz-compatible employer name for cross-source dedupe', () => {
    expect(vacancies?.[0].employer).toBe('Мостовская центральная районная больница');
    expect(vacancies?.[0].source).toBe('crb');
  });

  it('returns null when the vacancy list is missing (layout change)', () => {
    expect(parseCrbPage('<html><body>что-то другое</body></html>', PAGE_URL)).toBeNull();
  });
});
