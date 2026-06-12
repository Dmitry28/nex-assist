import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BROWSER_USER_AGENT } from '../../common/utils/scraping';
import { FETCH_TIMEOUT_MS, MAX_HTML_SIZE_BYTES } from './constants';
import type { JobVacancy } from './dto/job-vacancy.dto';

/** Embedded initial-state JSON on the rabota.by (hh.ru) search page. */
const INITIAL_STATE_RE = /<template[^>]*id="HH-Lux-InitialState"[^>]*>([\s\S]*?)<\/template>/i;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const getStr = (obj: Record<string, unknown>, key: string): string | undefined => {
  const value = obj[key];
  return typeof value === 'string' ? value : undefined;
};

const getNum = (obj: Record<string, unknown>, key: string): number | undefined => {
  const value = obj[key];
  return typeof value === 'number' ? value : undefined;
};

/** Format hh compensation {from?, to?, currencyCode?} into a human-readable line. */
const formatCompensation = (raw: unknown): string | undefined => {
  if (!isRecord(raw)) return undefined;
  const from = getNum(raw, 'from');
  const to = getNum(raw, 'to');
  if (from === undefined && to === undefined) return undefined;

  const code = getStr(raw, 'currencyCode');
  // BYR is hh's legacy code for Belarusian rubles.
  const currency = code === 'BYR' || code === 'BYN' || code === undefined ? 'руб.' : code;

  if (from !== undefined && to !== undefined) {
    if (from === to) return `${from} ${currency}`;
    return `${from} – ${to} ${currency}`;
  }
  return from !== undefined ? `от ${from} ${currency}` : `до ${to} ${currency}`;
};

const mapVacancy = (raw: unknown): JobVacancy | undefined => {
  if (!isRecord(raw)) return undefined;
  const vacancyId = getNum(raw, 'vacancyId');
  const title = getStr(raw, 'name');
  if (vacancyId === undefined || !title) return undefined;

  // Always construct the canonical URL — hh's links.desktop may carry tracking
  // params, and the URL is the snapshot diff key, so it must stay stable.
  const url = `https://rabota.by/vacancy/${vacancyId}`;

  const company = raw.company;
  const employer = isRecord(company)
    ? (getStr(company, 'visibleName') ?? getStr(company, 'name'))
    : undefined;

  const area = raw.area;
  const address = isRecord(area) ? getStr(area, 'name') : undefined;

  return {
    url,
    source: 'rabota',
    title,
    employer,
    salary: formatCompensation(raw.compensation),
    address,
  };
};

@Injectable()
export class RabotaParserService {
  private readonly logger = new Logger(RabotaParserService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Fetch the rabota.by search page and return vacancies.
   * Returns null when the source failed (network error, captcha page, layout change).
   */
  async fetch(): Promise<JobVacancy[] | null> {
    const url = this.config.getOrThrow<string>('mostyJobs.rabotaSearchUrl');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': BROWSER_USER_AGENT,
          'Accept-Language': 'ru-RU,ru;q=0.9',
        },
      });
      if (!res.ok) {
        this.logger.warn(`HTTP ${res.status} for ${url}`);
        return null;
      }
      const html = await res.text();
      if (html.length > MAX_HTML_SIZE_BYTES) {
        this.logger.warn(`Response too large (${html.length} bytes) for ${url}`);
        return null;
      }
      const vacancies = parseRabotaSearchHtml(html);
      if (vacancies === null) {
        this.logger.warn('rabota.by: initial-state JSON not found — captcha or layout change?');
        return null;
      }
      this.logger.log(`rabota.by: ${vacancies.length} vacancies fetched`);
      return vacancies;
    } catch (err) {
      this.logger.error(`Failed to fetch ${url}`, err);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ─── Pure parsing helpers ─────────────────────────────────────────────────────

/**
 * Extract vacancies from the rabota.by search page's embedded JSON.
 * Returns null when the page has no parseable initial state (treat as source
 * failure, not as "0 vacancies"). Exported for unit tests.
 */
export const parseRabotaSearchHtml = (html: string): JobVacancy[] | null => {
  const m = html.match(INITIAL_STATE_RE);
  if (!m) return null;

  let state: unknown;
  try {
    state = JSON.parse(m[1]);
  } catch {
    return null;
  }
  if (!isRecord(state)) return null;

  const searchResult = state.vacancySearchResult;
  if (!isRecord(searchResult)) return null;
  const vacancies = searchResult.vacancies;
  if (!Array.isArray(vacancies)) return null;

  return vacancies.flatMap(raw => {
    const vacancy = mapVacancy(raw);
    return vacancy ? [vacancy] : [];
  });
};
