import { parseRabotaSearchHtml } from '../rabota-parser.service';
import { RABOTA_SEARCH_PAGE_HTML } from './fixtures/rabota-search-page';

describe('parseRabotaSearchHtml', () => {
  const vacancies = parseRabotaSearchHtml(RABOTA_SEARCH_PAGE_HTML);

  it('parses all vacancies from the embedded JSON', () => {
    expect(vacancies).toHaveLength(3);
  });

  it('extracts title, url, employer and area', () => {
    expect(vacancies?.[0]).toMatchObject({
      url: 'https://rabota.by/vacancy/133356899',
      source: 'rabota',
      title: 'Специалист на пвз',
      employer: 'Лисовская Наталья Юрьевна',
      address: 'Мосты',
    });
  });

  it('formats "from" compensation as "от N руб."', () => {
    expect(vacancies?.[0].salary).toBe('от 900 руб.');
  });

  it('formats "to" compensation as "до N руб."', () => {
    expect(vacancies?.[1].salary).toBe('до 1200 руб.');
  });

  it('omits salary when compensation is absent', () => {
    expect(vacancies?.[2].salary).toBeUndefined();
  });

  it('returns null when the initial-state template is missing', () => {
    expect(parseRabotaSearchHtml('<html><body>captcha</body></html>')).toBeNull();
  });

  it('returns null when the template contains invalid JSON', () => {
    const html =
      '<template id="HH-Lux-InitialState" data-name="HH-Lux-InitialState">{oops</template>';
    expect(parseRabotaSearchHtml(html)).toBeNull();
  });
});
