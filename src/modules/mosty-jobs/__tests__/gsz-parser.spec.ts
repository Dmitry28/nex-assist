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

// gsz moved to UUID vacancy ids and started appending `?source=search` to every card link
// around 12 Aug 2026. The pattern wanted digits followed immediately by a quote, so it matched
// nothing — and "0 cards on page 1" is read as a source outage, which is what the daily summary
// reported for days while the site was up and full of vacancies.
describe('parseGszSearchHtml — the markup as the site serves it today', () => {
  const CARD = `
    <h4 class="job-title">
      <a href="/registration/employer/vacancy/90a01bb5-afd4-414f-b90c-de1b9eed85d2/detail-public/?source=search" title="Сторож">Сторож</a>
    </h4>
    <span class="salary">430 –
      550 руб.</span>
    <li class="org mt-2"><a href="/employer/1/">ОАО "Мотекс"</a></li>
    <span class="address">Мостовский район, г. Мосты</span>
    <div class="col-auto">
      <a href="/registration/employer/vacancy/263967/detail-public/?source=search/#contact-info-anchor">Контакты</a>
    </div>`;

  const vacancies = parseGszSearchHtml(CARD);

  it('parses a card whose id is a UUID and whose link carries a query string', () => {
    expect(vacancies).toHaveLength(1);
    expect(vacancies[0]).toMatchObject({
      url: 'https://gsz.gov.by/registration/employer/vacancy/90a01bb5-afd4-414f-b90c-de1b9eed85d2/detail-public/',
      title: 'Сторож',
      employer: 'ОАО "Мотекс"',
      salary: '430 – 550 руб.',
    });
  });

  it('still ignores the "Контакты" anchor now that a query string precedes its fragment', () => {
    expect(vacancies.map(v => v.url).join()).not.toContain('263967');
  });
});
