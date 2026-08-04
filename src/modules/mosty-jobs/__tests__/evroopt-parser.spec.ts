import { parseEvrooptJson } from '../evroopt-parser.service';

/** Realistic API item shape (fields observed live on static.erabota.by). */
const API_RESPONSE = JSON.stringify({
  data: [
    {
      id: 4943,
      name: 'Продавец (КСО)',
      url: '/63c6a87ec51e1b7001c0beeb628367a9f72bdd6b8109949e2449512001500',
      salary_from: 1740,
      salary_to: 2040,
      schedule: '2/2 по 12 часов',
      address: {
        id: 24517,
        name: 'Мосты,улица Мира,2А',
        skillaz_city: { id: 103173, name: 'Мосты' },
      },
    },
    {
      id: 5001,
      name: 'Кассир',
      url: '/6465e1e07256232d99b0bfc7627e31c510e8bee656bd4600257981400170',
      salary_from: 1500,
      salary_to: null,
      address: { name: 'Мосты,улица Пролетарская,26' },
    },
  ],
  last_page: 1,
  total: 2,
});

describe('parseEvrooptJson', () => {
  const vacancies = parseEvrooptJson(API_RESPONSE);

  // The API's own `url` field, verified live: this path renders "Грузчик, Мосты". The parser used
  // to ignore it and link every vacancy to the catalog instead.
  it('links to the vacancy itself, using the path the API returns', () => {
    expect(vacancies).toHaveLength(2);
    expect(vacancies?.[0]).toMatchObject({
      url: 'https://e-rabota.by/63c6a87ec51e1b7001c0beeb628367a9f72bdd6b8109949e2449512001500',
      source: 'evroopt',
      title: 'Продавец (КСО)',
      employer: 'Евроопт',
      salary: '1740 – 2040 руб.',
      address: 'Мосты,улица Мира,2А',
    });
  });

  it('formats a from-only salary', () => {
    expect(vacancies?.[1].salary).toBe('от 1500 руб.');
  });

  // A vacancy with no usable path is still worth sending — just pointed at the catalog.
  it('falls back to a catalog anchor when the path is missing or not a path', () => {
    const parsed = parseEvrooptJson(
      JSON.stringify({
        data: [
          { id: 77, name: 'Грузчик' },
          { id: 78, name: 'Кассир', url: 'javascript:void(0)' },
        ],
      }),
    );
    expect(parsed?.map(v => v.url)).toEqual([
      'https://e-rabota.by/vacancies#evroopt-77',
      'https://e-rabota.by/vacancies#evroopt-78',
    ]);
  });

  it('returns an empty list for the empty-city response', () => {
    expect(parseEvrooptJson('{"data":[],"last_page":0,"total":0}')).toEqual([]);
  });

  // This predicate is also the ladder's `isUsable`, so each rejection below is a rung that
  // escalates instead of reporting success on a body it cannot use.
  it('returns null for the challenge page', () => {
    expect(parseEvrooptJson('<!DOCTYPE html><html>Verification…</html>')).toBeNull();
  });

  it('returns null for the 403 page served to non-Belarusian addresses', () => {
    const denied = '<html><title>Access denied</title><body>403 ЗАПРОС ЗАБЛОКИРОВАН</body></html>';
    expect(parseEvrooptJson(denied)).toBeNull();
  });

  it('returns null for JSON without a data array', () => {
    expect(parseEvrooptJson('{"total":0}')).toBeNull();
  });

  // Rung 2 reads the API through a browser, which hands back Chrome's `<pre>` rendering of the
  // JSON with the quotes escaped. Without unwrapping that, the free rung would look like a
  // failure and every run would pay a provider.
  it('unwraps and unescapes a JSON body captured through a browser', () => {
    const throughBrowser =
      '<html><head></head><body><pre style="word-wrap: break-word;">' +
      '{&quot;data&quot;:[{&#34;id&#34;:4943,&#34;name&#34;:&#34;Продавец&#34;,&#34;url&#34;:&#34;/abc&#34;}]}' +
      '</pre></body></html>';
    expect(parseEvrooptJson(throughBrowser)).toEqual([
      {
        url: 'https://e-rabota.by/abc',
        source: 'evroopt',
        title: 'Продавец',
        employer: 'Евроопт',
        salary: undefined,
        address: undefined,
      },
    ]);
  });
});
