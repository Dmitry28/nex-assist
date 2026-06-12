import { parseEvrooptJson } from '../evroopt-parser.service';

/** Realistic API item shape (fields observed live on static.erabota.by). */
const API_RESPONSE = JSON.stringify({
  data: [
    {
      id: 4943,
      name: 'Продавец (КСО)',
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

  it('parses vacancies with id-keyed catalog URLs', () => {
    expect(vacancies).toHaveLength(2);
    expect(vacancies?.[0]).toMatchObject({
      url: 'https://e-rabota.by/vacancies#evroopt-4943',
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

  it('returns an empty list for the empty-city response', () => {
    expect(parseEvrooptJson('{"data":[],"last_page":0,"total":0}')).toEqual([]);
  });

  it('returns null while the JS challenge page is still showing', () => {
    expect(parseEvrooptJson('<!DOCTYPE html><html>Verification…</html>')).toBeNull();
  });

  it('returns null for JSON without a data array', () => {
    expect(parseEvrooptJson('{"total":0}')).toBeNull();
  });
});
