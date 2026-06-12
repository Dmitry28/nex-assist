import { parseKufarJobsJson } from '../kufar-jobs-parser.service';
import { KUFAR_JOBS_EMPTY_JSON, KUFAR_JOBS_JSON } from './fixtures/kufar-jobs';

describe('parseKufarJobsJson', () => {
  it('parses a job ad with kopeck price converted to rubles', () => {
    const vacancies = parseKufarJobsJson(KUFAR_JOBS_JSON);
    expect(vacancies).toHaveLength(1);
    expect(vacancies?.[0]).toMatchObject({
      url: 'https://www.kufar.by/item/244995475',
      source: 'kufar',
      title: 'Сортировщик. Работник склада.',
      salary: '3500 руб.',
      address: 'Гродно',
    });
  });

  it('returns an empty list for the empty search response', () => {
    expect(parseKufarJobsJson(KUFAR_JOBS_EMPTY_JSON)).toEqual([]);
  });

  it('returns null for invalid JSON', () => {
    expect(parseKufarJobsJson('<html>blocked</html>')).toBeNull();
  });

  it('returns null for JSON without an ads array', () => {
    expect(parseKufarJobsJson('{"total": 0}')).toBeNull();
  });
});
