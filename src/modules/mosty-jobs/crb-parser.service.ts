import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JobVacancy } from './dto/job-vacancy.dto';
import { fetchText } from './mosty-jobs-http';

/**
 * The vacancy list on mostycrb.by is a single `<ol>` right after the heading:
 *   <h3>В УЗ «Мостовская ЦРБ» имеются вакансии:</h3> <ol> <li>…</li> … </ol>
 */
const LIST_RE = /имеются\s+вакансии[\s\S]*?<ol>([\s\S]*?)<\/ol>/i;
const ITEM_RE = /<li[^>]*>([\s\S]*?)<\/li>/gi;

/** Matches the gsz employer name so cross-source dedupe can silence overlaps. */
const CRB_EMPLOYER = 'Мостовская центральная районная больница';

const stripTags = (html: string): string =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

@Injectable()
export class CrbParserService {
  private readonly logger = new Logger(CrbParserService.name);

  constructor(private readonly config: ConfigService) {}

  /** Fetch the Мостовская ЦРБ vacancies page. Returns null when the source failed. */
  async fetch(): Promise<JobVacancy[] | null> {
    const url = this.config.getOrThrow<string>('mostyJobs.crbUrl');
    const html = await fetchText(url, this.logger);
    if (html === null) return null;

    const vacancies = parseCrbPage(html, url);
    if (vacancies === null) {
      this.logger.warn('mostycrb.by: vacancy list not found — layout change?');
      return null;
    }
    this.logger.log(`mostycrb.by: ${vacancies.length} vacancies fetched`);
    return vacancies;
  }
}

// ─── Pure parsing helpers ─────────────────────────────────────────────────────

/**
 * Parse the ЦРБ vacancies page. The list items have no individual URLs, so the
 * diff key is the page URL with the normalized title as a fragment.
 * Returns null when the heading/list is missing (treat as source failure).
 * Exported for unit tests.
 */
export const parseCrbPage = (html: string, pageUrl: string): JobVacancy[] | null => {
  const list = html.match(LIST_RE);
  if (!list) return null;

  const vacancies: JobVacancy[] = [];
  const seen = new Set<string>();
  for (const m of list[1].matchAll(ITEM_RE)) {
    const title = stripTags(m[1]);
    if (!title) continue;
    const key = title.toLowerCase().replace(/\s+/g, '-');
    if (seen.has(key)) continue;
    seen.add(key);
    vacancies.push({
      url: `${pageUrl}#${encodeURIComponent(key)}`,
      source: 'crb',
      title,
      employer: CRB_EMPLOYER,
      address: 'г. Мосты',
    });
  }
  return vacancies;
};
