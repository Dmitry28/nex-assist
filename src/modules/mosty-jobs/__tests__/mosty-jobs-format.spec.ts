import type { JobVacancy, MostyJobsResult } from '../dto/job-vacancy.dto';
import { buildSummary, buildVacancyMessage } from '../mosty-jobs-format';

const baseVacancy: JobVacancy = {
  url: 'https://gsz.gov.by/registration/employer/vacancy/123/detail-public/',
  source: 'gsz',
  title: 'Педагог социальный',
};

const baseResult: MostyJobsResult = {
  totals: { gsz: 240, rabota: 10, joblab: 14, kufar: 0 },
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
});
