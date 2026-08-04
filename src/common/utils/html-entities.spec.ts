import { decodeHtmlEntities } from './html-entities';

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

  // The second caller, and the reason this moved out of the rabota parser: Chrome renders a JSON
  // response into a <pre> with the quotes escaped, so rung 2 of the ladder needs the same decode.
  it('produces parseable JSON from the escaping Chrome applies inside <pre>', () => {
    const inner = '{&quot;data&quot;:[{&#34;id&#34;:1,&#34;name&#34;:&#34;Грузчик&#34;}]}';
    const parsed = JSON.parse(decodeHtmlEntities(inner)) as { data: { name: string }[] };
    expect(parsed.data[0].name).toBe('Грузчик');
  });
});
