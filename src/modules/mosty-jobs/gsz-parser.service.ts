import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import https from 'https';
import { BROWSER_USER_AGENT } from '../../common/utils/scraping';
import { FETCH_TIMEOUT_MS, MAX_GSZ_PAGES, MAX_HTML_SIZE_BYTES } from './constants';
import { GSZ_CA_BUNDLE } from './constants/gsz-ca';
import type { JobVacancy } from './dto/job-vacancy.dto';

/**
 * Vacancy card title anchor on the gsz.gov.by search results page:
 *   <a href="/registration/employer/vacancy/{id}/detail-public/" title="..." class="debounced-link">TITLE</a>
 *
 * The card's "Контакты" button links to the same path with a `#contact-info-anchor`
 * fragment — requiring `/"` right after `detail-public/` excludes it.
 */
const CARD_ANCHOR_RE =
  /<a\s+href="\/registration\/employer\/vacancy\/(\d+)\/detail-public\/"[^>]*>([\s\S]*?)<\/a>/gi;

/** Salary line inside a card, e.g. " 1 400 –\n      1 500 руб." */
const SALARY_RE = /<span\s+class="salary">([\s\S]*?)<\/span>/i;

/** Employer link inside the card's `<li class="org ...">` block. */
const EMPLOYER_RE = /<li\s+class="org[^"]*">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i;

/** Workplace address inside a card. */
const ADDRESS_RE = /<span\s+class="address">([\s\S]*?)<\/span>/i;

const stripTags = (html: string): string =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '–')
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

const matchText = (section: string, re: RegExp): string | undefined => {
  const m = section.match(re);
  if (!m) return undefined;
  const text = stripTags(m[1]);
  return text || undefined;
};

interface PageResult {
  /** HTML body, or null when the page does not exist (404 = past the last page). */
  html: string | null;
  status: number;
}

@Injectable()
export class GszParserService {
  private readonly logger = new Logger(GszParserService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Fetch all result pages and return the deduplicated vacancy list.
   * Returns null when the source failed entirely (first page unreachable) —
   * the caller must distinguish "source down" from "no vacancies".
   */
  async fetch(): Promise<JobVacancy[] | null> {
    const baseUrl = this.config.getOrThrow<string>('mostyJobs.gszSearchUrl');
    const byUrl = new Map<string, JobVacancy>();

    for (let page = 1; page <= MAX_GSZ_PAGES; page++) {
      const pageUrl = new URL(baseUrl);
      pageUrl.searchParams.set('page', String(page));
      const url = pageUrl.toString();
      let result: PageResult;
      try {
        result = await this.fetchPage(url);
      } catch (err) {
        this.logger.error(`Failed to fetch gsz page ${page}`, err);
        // First page down = source failure; later pages: keep what we have.
        return page === 1 ? null : [...byUrl.values()];
      }

      if (result.html === null) break; // 404 — past the last page

      const vacancies = parseGszSearchHtml(result.html);
      if (vacancies.length === 0) {
        this.logger.warn(`gsz page ${page} returned 0 cards — stopping pagination`);
        // 0 cards on the first page = layout change or block page, not "no vacancies"
        // (the district has hundreds) — treat as source failure.
        if (page === 1) return null;
        break;
      }
      for (const v of vacancies) byUrl.set(v.url, v);
    }

    this.logger.log(`gsz.gov.by: ${byUrl.size} vacancies fetched`);
    return [...byUrl.values()];
  }

  /**
   * Plain https.get instead of fetch(): the server omits its intermediate
   * certificate, so we must supply the Let's Encrypt chain as trust anchors —
   * global fetch() has no per-request CA option.
   */
  private fetchPage(url: string): Promise<PageResult> {
    return new Promise<PageResult>((resolve, reject) => {
      const req = https.get(
        url,
        {
          ca: [...GSZ_CA_BUNDLE],
          timeout: FETCH_TIMEOUT_MS,
          headers: {
            'User-Agent': BROWSER_USER_AGENT,
            'Accept-Language': 'ru-RU,ru;q=0.9',
          },
        },
        res => {
          if (res.statusCode === 404) {
            res.resume();
            resolve({ html: null, status: 404 });
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            return;
          }
          let size = 0;
          const chunks: Buffer[] = [];
          res.on('error', reject);
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_HTML_SIZE_BYTES) {
              req.destroy(new Error(`Response too large (>${MAX_HTML_SIZE_BYTES} bytes)`));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () =>
            resolve({ html: Buffer.concat(chunks).toString('utf8'), status: 200 }),
          );
        },
      );
      req.on('timeout', () => req.destroy(new Error(`Timeout after ${FETCH_TIMEOUT_MS}ms`)));
      req.on('error', reject);
    });
  }
}

// ─── Pure parsing helpers ─────────────────────────────────────────────────────

/**
 * Parse one gsz.gov.by search results page into vacancies.
 * Cards are sliced between consecutive title anchors — salary/employer/address
 * are matched within each slice. Exported for unit tests.
 */
export const parseGszSearchHtml = (html: string): JobVacancy[] => {
  // Empty-title anchors are kept as section boundaries but never emitted as vacancies.
  const anchors = [...html.matchAll(CARD_ANCHOR_RE)].map(m => ({
    id: m[1],
    title: stripTags(m[2]),
    index: m.index ?? 0,
    endIndex: (m.index ?? 0) + m[0].length,
  }));

  const vacancies: JobVacancy[] = [];
  const seen = new Set<string>();
  for (const [i, anchor] of anchors.entries()) {
    if (!anchor.title || seen.has(anchor.id)) continue;
    seen.add(anchor.id);

    const sectionEnd = i + 1 < anchors.length ? anchors[i + 1].index : html.length;
    const section = html.slice(anchor.endIndex, sectionEnd);

    vacancies.push({
      url: `https://gsz.gov.by/registration/employer/vacancy/${anchor.id}/detail-public/`,
      source: 'gsz',
      title: anchor.title,
      employer: matchText(section, EMPLOYER_RE),
      salary: matchText(section, SALARY_RE),
      address: matchText(section, ADDRESS_RE),
    });
  }
  return vacancies;
};
