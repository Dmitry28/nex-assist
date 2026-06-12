import { LOCALE, TIMEZONE } from '../../common/utils/locale';
import { escapeHtml } from '../../common/utils/telegram';
import { SOURCE_LABELS } from './constants';
import { JOB_SOURCES, type JobVacancy, type MostyJobsResult } from './dto/job-vacancy.dto';

export interface VacancyMessageParams {
  vacancy: JobVacancy;
  header: string;
  index: number;
  total: number;
}

export const buildVacancyMessage = ({
  vacancy,
  header,
  index,
  total,
}: VacancyMessageParams): string => {
  const lines: string[] = [
    `<b>${header} · ${index}/${total}</b>`,
    '',
    `💼 <b>${escapeHtml(vacancy.title)}</b>`,
  ];
  if (vacancy.employer) lines.push(`🏢 ${escapeHtml(vacancy.employer)}`);
  if (vacancy.salary) lines.push(`💰 ${escapeHtml(vacancy.salary)}`);
  if (vacancy.address) lines.push(`📍 ${escapeHtml(vacancy.address)}`);
  lines.push('', `<a href="${vacancy.url}">🔗 ${SOURCE_LABELS[vacancy.source]}</a>`);
  return lines.join('\n');
};

const formatSourceTotal = (label: string, total: number | null): string =>
  total === null ? `⚠️ ${label}: недоступен` : `${label}: <b>${total}</b>`;

export const buildSummary = (result: MostyJobsResult): string => {
  const date = new Date().toLocaleDateString(LOCALE, { timeZone: TIMEZONE });
  const lines = [
    `<b>💼 Вакансии · Мостовский район · ${date}</b>`,
    '',
    ...JOB_SOURCES.map(source => formatSourceTotal(SOURCE_LABELS[source], result.totals[source])),
    '',
    result.newVacancies.length > 0
      ? `🆕 ${result.newVacancies.length} нов(ых)`
      : 'Новых вакансий нет',
  ];
  if (result.seededCount > 0) {
    lines.push(`💾 baseline · ${result.seededCount} вакансий сохранено без уведомлений`);
  }
  return lines.join('\n');
};
