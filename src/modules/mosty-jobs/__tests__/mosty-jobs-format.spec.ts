import type { JobVacancy, MostyJobsResult } from '../dto/job-vacancy.dto';
import { buildSummary, buildVacancyMessage, buildDigests } from '../mosty-jobs-format';

const baseVacancy: JobVacancy = {
  url: 'https://gsz.gov.by/registration/employer/vacancy/123/detail-public/',
  source: 'gsz',
  title: 'Педагог социальный',
};

const baseResult: MostyJobsResult = {
  totals: { gsz: 240, rabota: 10, joblab: 14, evroopt: 0, crb: 8, kufar: 0, fair: 1 },
  newVacancies: [],
  seededCount: 0,
  duplicateCount: 0,
};

describe('buildVacancyMessage', () => {
  it('includes header, title, source label and link', () => {
    const message = buildVacancyMessage({
      vacancy: baseVacancy,
      header: '🆕 Новая вакансия',
      index: 1,
      total: 3,
    });
    expect(message).toContain('🆕 Новая вакансия · 1/3');
    expect(message).toContain('Педагог социальный');
    expect(message).toContain('gsz.gov.by');
    expect(message).toContain(baseVacancy.url);
  });

  it('includes optional fields when present', () => {
    const vacancy: JobVacancy = {
      ...baseVacancy,
      employer: 'Школа №2',
      salary: '1 400 – 1 500 руб.',
      address: 'г. Мосты, Советская, 5',
    };
    const message = buildVacancyMessage({ vacancy, header: 'H', index: 1, total: 1 });
    expect(message).toContain('🏢 Школа №2');
    expect(message).toContain('💰 1 400 – 1 500 руб.');
    expect(message).toContain('📍 г. Мосты, Советская, 5');
  });

  it('escapes HTML in scraped fields', () => {
    const vacancy: JobVacancy = {
      ...baseVacancy,
      title: 'Слесарь <3 разряда>',
      employer: 'ОАО "Рога & Копыта"',
    };
    const message = buildVacancyMessage({ vacancy, header: 'H', index: 1, total: 1 });
    expect(message).toContain('Слесарь &lt;3 разряда&gt;');
    expect(message).toContain('Рога &amp; Копыта');
  });

  it('skips optional lines when fields are absent', () => {
    const message = buildVacancyMessage({ vacancy: baseVacancy, header: 'H', index: 1, total: 1 });
    expect(message).not.toContain('🏢');
    expect(message).not.toContain('💰');
    expect(message).not.toContain('📍');
  });
});

describe('buildSummary', () => {
  it('shows per-source totals and "no new" line', () => {
    const summary = buildSummary(baseResult);
    expect(summary).toContain('Мостовский район');
    expect(summary).toContain('gsz.gov.by: <b>240</b>');
    expect(summary).toContain('rabota.by: <b>10</b>');
    expect(summary).toContain('joblab.by: <b>14</b>');
    expect(summary).toContain('Мостовская ЦРБ: <b>8</b>');
    expect(summary).toContain('ярмарки (e-vacancy.by): <b>1</b>');
    expect(summary).toContain('kufar.by: <b>0</b>');
    expect(summary).toContain('Новых вакансий нет');
  });

  it('shows new vacancies count', () => {
    const summary = buildSummary({ ...baseResult, newVacancies: [baseVacancy] });
    expect(summary).toContain('🆕 1 нов(ых)');
  });

  it('marks a failed source', () => {
    const summary = buildSummary({ ...baseResult, totals: { ...baseResult.totals, gsz: null } });
    expect(summary).toContain('⚠️ gsz.gov.by: недоступен');
  });

  it('mentions seeded baseline entries', () => {
    const summary = buildSummary({ ...baseResult, seededCount: 250 });
    expect(summary).toContain('250 вакансий сохранено без уведомлений');
  });

  it('links each source label to its monitored URL when provided', () => {
    const summary = buildSummary(baseResult, {
      gsz: 'https://gsz.gov.by/search',
      crb: 'https://mostycrb.by/vacancies',
    });
    expect(summary).toContain('<a href="https://gsz.gov.by/search">gsz.gov.by</a>: <b>240</b>');
    expect(summary).toContain(
      '<a href="https://mostycrb.by/vacancies">Мостовская ЦРБ</a>: <b>8</b>',
    );
  });
});

// A source returning from an outage can produce more vacancies than a run can send as cards,
// 3.1s apart. The rest used to wait for tomorrow, which defeats a daily monitor — they now go
// out as a list the same day.
describe('buildDigests', () => {
  const vacancy = (i: number, extra: Partial<JobVacancy> = {}): JobVacancy => ({
    url: `https://gsz.gov.by/vacancy/${i}/`,
    source: 'gsz',
    title: `Слесарь ${i}`,
    ...extra,
  });

  it('lists every remaining vacancy in one message when they fit', () => {
    const [digest, ...rest] = buildDigests([vacancy(1), vacancy(2)], 21, 22);

    expect(rest).toHaveLength(0);
    expect(digest.vacancies).toHaveLength(2);
    expect(digest.text).toContain('21-22 из 22');
    expect(digest.text).toContain('Слесарь 1');
    expect(digest.text).toContain('https://gsz.gov.by/vacancy/2/');
  });

  it('appends employer and salary when known', () => {
    const [digest] = buildDigests(
      [vacancy(1, { employer: 'ОАО "Мотекс"', salary: '1000 – 1300 руб.' })],
      2,
      2,
    );

    // escapeHtml here covers &, < and > — quotes are left as the seller wrote them.
    expect(digest.text).toContain('ОАО "Мотекс" · 1000 – 1300 руб.');
  });

  it('splits into several messages rather than exceeding the Telegram limit', () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      vacancy(i, { employer: 'Очень длинное название предприятия для проверки лимита сообщения' }),
    );

    const digests = buildDigests(many, 21, 140);

    expect(digests.length).toBeGreaterThan(1);
    expect(Math.max(...digests.map(d => d.text.length))).toBeLessThanOrEqual(4096);
    // Nothing is dropped in the chunking — the whole tail is still accounted for.
    expect(digests.flatMap(d => d.vacancies)).toHaveLength(120);
  });

  it('returns nothing when there is no tail', () => {
    expect(buildDigests([], 1, 0)).toEqual([]);
  });
});
