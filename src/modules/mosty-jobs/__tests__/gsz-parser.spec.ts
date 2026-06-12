import { parseGszSearchHtml } from '../gsz-parser.service';
import { GSZ_SEARCH_PAGE_HTML } from './fixtures/gsz-search-page';

describe('parseGszSearchHtml', () => {
  const vacancies = parseGszSearchHtml(GSZ_SEARCH_PAGE_HTML);

  it('parses all vacancy cards', () => {
    expect(vacancies).toHaveLength(3);
  });

  it('extracts title, url and source from the card anchor', () => {
    expect(vacancies[0]).toMatchObject({
      url: 'https://gsz.gov.by/registration/employer/vacancy/1867051/detail-public/',
      source: 'gsz',
      title: 'Педагог социальный',
    });
  });

  it('does not treat the "Контакты" anchor (same path + fragment) as a separate card', () => {
    const urls = vacancies.map(v => v.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('extracts and normalizes the salary line', () => {
    expect(vacancies[0].salary).toBe('1 400 – 1 500 руб.');
    expect(vacancies[2].salary).toBe('1 500 – 1 800 руб.');
  });

  it('extracts the employer name', () => {
    expect(vacancies[0].employer).toBe('Дубненская средняя школа им. А.С. Данилова');
    expect(vacancies[2].employer).toBe('ОАО "Мостовдрев"');
  });

  it('extracts the workplace address', () => {
    expect(vacancies[0].address).toBe(
      'Гродненская область, Мостовский район, сельсовет Дубненский, аг. Дубно, Школьная, 9',
    );
  });

  it('returns an empty array for HTML without vacancy cards', () => {
    expect(parseGszSearchHtml('<html><body>Ничего не найдено</body></html>')).toEqual([]);
  });

  it('deduplicates cards with the same vacancy id', () => {
    const doubled = GSZ_SEARCH_PAGE_HTML + GSZ_SEARCH_PAGE_HTML;
    expect(parseGszSearchHtml(doubled)).toHaveLength(3);
  });
});
