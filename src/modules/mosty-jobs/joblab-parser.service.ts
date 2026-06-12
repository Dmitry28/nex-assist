import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JobVacancy } from './dto/job-vacancy.dto';
import { fetchText } from './mosty-jobs-http';

const ITEM_RE = /<item>([\s\S]*?)<\/item>/gi;
const TITLE_RE = /<title>([\s\S]*?)<\/title>/i;
const LINK_RE = /<link>\s*(https?:\/\/joblab\.by\/vacancy\/\d+)\s*<\/link>/i;
const DESCRIPTION_RE = /<description>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/description>/i;

const decodeEntities = (s: string): string =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * RSS description starts with a metadata line before the first <br>:
 *   ООО &quot;Санта Ритейл&quot; / Мосты / Зарплата от 1 340 руб. <br><br>текст…
 */
const parseDescriptionMeta = (
  description: string,
): { employer?: string; address?: string; salary?: string } => {
  const metaLine = decodeEntities(description.split(/<br\s*\/?>/i)[0] ?? '');
  if (!metaLine) return {};
  const parts = metaLine.split(' / ').map(p => p.trim());
  const salaryPart = parts.find(p => /зарплата/i.test(p));
  return {
    employer: parts[0] || undefined,
    address: parts[1] || undefined,
    salary: salaryPart?.replace(/^Зарплата\s*/i, '') || undefined,
  };
};

@Injectable()
export class JoblabParserService {
  private readonly logger = new Logger(JoblabParserService.name);

  constructor(private readonly config: ConfigService) {}

  /** Fetch the joblab.by RSS feed. Returns null when the source failed. */
  async fetch(): Promise<JobVacancy[] | null> {
    const url = this.config.getOrThrow<string>('mostyJobs.joblabRssUrl');
    const xml = await fetchText(url, this.logger);
    if (xml === null) return null;

    const vacancies = parseJoblabRss(xml);
    if (vacancies === null) {
      this.logger.warn('joblab.by: response is not a parseable RSS feed');
      return null;
    }
    this.logger.log(`joblab.by: ${vacancies.length} vacancies fetched`);
    return vacancies;
  }
}

// ─── Pure parsing helpers ─────────────────────────────────────────────────────

/**
 * Parse the joblab.by RSS feed. Returns null when the payload is not RSS
 * (treat as source failure); an RSS feed with zero items is a valid empty list.
 * Exported for unit tests.
 */
export const parseJoblabRss = (xml: string): JobVacancy[] | null => {
  if (!/<rss[\s>]/i.test(xml)) return null;

  const vacancies: JobVacancy[] = [];
  const seen = new Set<string>();
  for (const itemMatch of xml.matchAll(ITEM_RE)) {
    const item = itemMatch[1];
    const link = item.match(LINK_RE)?.[1];
    const rawTitle = item.match(TITLE_RE)?.[1];
    if (!link || !rawTitle) continue;
    if (seen.has(link)) continue;
    seen.add(link);

    const meta = parseDescriptionMeta(item.match(DESCRIPTION_RE)?.[1] ?? '');
    vacancies.push({
      url: link,
      source: 'joblab',
      title: decodeEntities(rawTitle),
      ...meta,
    });
  }
  return vacancies;
};
