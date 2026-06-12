import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MAX_FAIR_PAGES } from './constants';
import type { JobVacancy } from './dto/job-vacancy.dto';
import { fetchText } from './mosty-jobs-http';

/**
 * A fair card on e-vacancy.by/markets/:
 *   <h2 class="market-card__title"><a href="/markets/5659/" …>TITLE</a></h2>
 *   <p class="market-card__period">16 июня 2026 г.</p>
 */
const CARD_RE =
  /<h2\s+class="market-card__title">\s*<a\s+href="\/markets\/(\d+)\/"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>[\s\S]*?<p\s+class="market-card__period">([\s\S]*?)<\/p>/gi;

/** Upcoming fairs for our district mention it in the genitive: "Мостовского района". */
const MOSTY_RE = /Мостовск/i;

const stripTags = (html: string): string =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

@Injectable()
export class FairParserService {
  private readonly logger = new Logger(FairParserService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Fetch upcoming электронные ярмарки вакансий and return the Мостовский
   * район ones as pseudo-vacancies (the module pipeline notifies once per new
   * fair). Returns null when the source failed entirely.
   */
  async fetch(): Promise<JobVacancy[] | null> {
    const baseUrl = this.config.getOrThrow<string>('mostyJobs.fairsUrl');
    const fairs: JobVacancy[] = [];

    for (let page = 1; page <= MAX_FAIR_PAGES; page++) {
      const pageUrl = new URL(baseUrl);
      pageUrl.searchParams.set('page', String(page));
      const html = await fetchText(pageUrl.toString(), this.logger);
      if (html === null) {
        // First page down = source failure; later pages: keep what we have.
        return page === 1 ? null : fairs;
      }

      const cards = parseFairPage(html);
      if (cards.all === 0) break; // past the last page
      fairs.push(...cards.mosty);
    }

    this.logger.log(`e-vacancy.by: ${fairs.length} Мостовский район fair(s) listed`);
    return fairs;
  }
}

// ─── Pure parsing helpers ─────────────────────────────────────────────────────

/**
 * Parse one e-vacancy.by/markets/ page: returns the total card count (for
 * pagination control) and the Мостовский район fairs. Exported for unit tests.
 */
export const parseFairPage = (html: string): { all: number; mosty: JobVacancy[] } => {
  let all = 0;
  const mosty: JobVacancy[] = [];
  for (const m of html.matchAll(CARD_RE)) {
    all++;
    const title = stripTags(m[2]);
    if (!title || !MOSTY_RE.test(title)) continue;
    const period = stripTags(m[3]);
    mosty.push({
      url: `https://e-vacancy.by/markets/${m[1]}/`,
      source: 'fair',
      title: period ? `${title} · ${period}` : title,
    });
  }
  return { all, mosty };
};
