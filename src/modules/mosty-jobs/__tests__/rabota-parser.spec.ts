import { parseRabotaSearchHtml, decodeHtmlEntities } from '../rabota-parser.service';
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

describe('decodeHtmlEntities', () => {
  // hh.ru switched its embedded state from raw JSON to entity-escaped JSON, and uses the
  // numeric form. Assuming `&quot;` would have missed it entirely — JSON.parse fails at
  // position 1, which read as "captcha or layout change?" for days.
  it('decodes the numeric entities hh.ru actually emits', () => {
    expect(decodeHtmlEntities('{&#34;a&#34;:1}')).toBe('{"a":1}');
  });

  it('decodes hex entities', () => {
    expect(decodeHtmlEntities('&#x22;x&#x22;')).toBe('"x"');
  });

  it('decodes the named entities too', () => {
    expect(decodeHtmlEntities('&quot;a&quot; &lt;b&gt; &apos;c&apos; &amp;')).toBe(
      '"a" <b> \'c\' &',
    );
  });

  it('leaves unknown entities untouched rather than dropping text', () => {
    expect(decodeHtmlEntities('&unknownthing; kept')).toBe('&unknownthing; kept');
  });

  it('is a single pass, so a decoded ampersand cannot be re-consumed', () => {
    // `&amp;#34;` must become the literal `&#34;`, not a quote.
    expect(decodeHtmlEntities('&amp;#34;')).toBe('&#34;');
  });

  it('produces parseable JSON from an escaped payload', () => {
    const escaped = '{&#34;vacancySearchResult&#34;:{&#34;vacancies&#34;:[]}}';
    expect(() => JSON.parse(decodeHtmlEntities(escaped)) as unknown).not.toThrow();
  });
});
