import { LOCALE, TIMEZONE } from '../../common/utils/locale';
import { escapeHtml, TELEGRAM_MESSAGE_LIMIT } from '../../common/utils/telegram';
import { SOURCE_LABELS } from './constants';
import {
  JOB_SOURCES,
  type JobSource,
  type JobVacancy,
  type MostyJobsResult,
} from './dto/job-vacancy.dto';

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

/** One digest message: its rendered text and the vacancies it accounts for. */
export interface VacancyDigest {
  text: string;
  vacancies: JobVacancy[];
}

/** A digest line: title as the link, employer and salary appended when known. */
const digestLine = (v: JobVacancy): string => {
  const bits = [v.employer, v.salary].filter((b): b is string => Boolean(b)).map(escapeHtml);
  const tail = bits.length > 0 ? ` — ${bits.join(' · ')}` : '';
  return `• <a href="${v.url}">${escapeHtml(v.title)}</a>${tail}`;
};

/**
 * The tail of a large batch, as list messages instead of dozens of cards.
 *
 * Individual cards are paced 3.1s apart, so a source coming back from an outage can produce more
 * vacancies than one run can send one at a time. Holding the rest until tomorrow defeats the
 * point of a daily monitor — everything new should be visible the same day — so what does not
 * fit as a card goes out as a compact list, chunked to Telegram's per-message limit.
 */
export const buildDigests = (rest: JobVacancy[], from: number, total: number): VacancyDigest[] => {
  const header = `<b>📋 Ещё ${rest.length} вакансия(й) · ${from}-${total} из ${total}</b>`;
  const digests: VacancyDigest[] = [];

  let lines = [header, ''];
  let vacancies: JobVacancy[] = [];
  const flush = (): void => {
    if (vacancies.length > 0) digests.push({ text: lines.join('\n'), vacancies });
    lines = [header, ''];
    vacancies = [];
  };

  for (const v of rest) {
    const line = digestLine(v);
    const wouldBe = [...lines, line].join('\n').length;
    if (wouldBe > TELEGRAM_MESSAGE_LIMIT) flush();
    lines.push(line);
    vacancies.push(v);
  }
  flush();

  return digests;
};

/** Per-source monitored URLs — the summary links each source label to its search page. */
export type MostyJobsSourceUrls = Partial<Record<JobSource, string>>;

const formatSourceTotal = (label: string, total: number | null, url?: string): string => {
  const linkedLabel = url ? `<a href="${url}">${label}</a>` : label;
  return total === null ? `⚠️ ${linkedLabel}: недоступен` : `${linkedLabel}: <b>${total}</b>`;
};

export const buildSummary = (
  result: MostyJobsResult,
  sourceUrls: MostyJobsSourceUrls = {},
): string => {
  const date = new Date().toLocaleDateString(LOCALE, { timeZone: TIMEZONE });
  const lines = [
    `<b>💼 Вакансии · Мостовский район · ${date}</b>`,
    '',
    ...JOB_SOURCES.map(source =>
      formatSourceTotal(SOURCE_LABELS[source], result.totals[source], sourceUrls[source]),
    ),
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
