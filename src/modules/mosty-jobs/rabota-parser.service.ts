import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JobVacancy } from './dto/job-vacancy.dto';
import { EscalatingHtmlFetcher } from '../../common/scraping/escalating-html-fetcher';
import { FETCH_TIMEOUT_MS, MAX_HTML_SIZE_BYTES } from './constants';

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

  constructor(
    private readonly config: ConfigService,
    private readonly html: EscalatingHtmlFetcher,
  ) {}

  /**
   * Fetch the rabota.by search page and return vacancies.
   * Returns null when the source failed (network error, captcha page, layout change).
   */
  async fetch(): Promise<JobVacancy[] | null> {
    const url = this.config.getOrThrow<string>('mostyJobs.rabotaSearchUrl');
    // Same ladder as every other site: plain request, then a browser, then the providers.
    // This source failed on a plain fetch in production while the others answered, and a lost
    // source is invisible in the summary — the module reports what it got, not what it missed.
    const html = await this.html.fetch(url, {
      label: 'rabota.by',
      // Test for the marker the parser actually needs, not a substring any page contains.
      // `includes('vacancy')` matched hh.ru's anti-bot page too, so rung 1 reported success on
      // an unusable body and the ladder never escalated — the source just went down.
      isUsable: body => INITIAL_STATE_RE.test(body),
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: MAX_HTML_SIZE_BYTES,
    });
    if (html === null) return null;

    const vacancies = parseRabotaSearchHtml(html);
    if (vacancies === null) {
      this.logger.warn('rabota.by: initial-state JSON not found — captcha or layout change?');
      return null;
    }
    this.logger.log(`rabota.by: ${vacancies.length} vacancies fetched`);
    return vacancies;
  }
}

// ─── Pure parsing helpers ─────────────────────────────────────────────────────

/**
 * Extract vacancies from the rabota.by search page's embedded JSON.
 * Returns null when the page has no parseable initial state (treat as source
 * failure, not as "0 vacancies"). Exported for unit tests.
 */
/**
 * Decodes the HTML entities hh.ru now escapes its embedded state with.
 *
 * The `<template>` used to hold raw JSON; it currently holds the same JSON with every quote
 * written as `&#34;`. JSON.parse fails at position 1 on that, which surfaced as "initial-state
 * JSON not found — captcha or layout change?" — the layout-change half of that guess was right.
 *
 * Numeric entities are handled as well as named ones: only the numeric form appears today, and
 * assuming `&quot;` would have missed it entirely.
 */
export const decodeHtmlEntities = (input: string): string => {
  const named: Record<string, string> = {
    quot: '"',
    apos: "'",
    lt: '<',
    gt: '>',
    nbsp: '\u00a0',
    amp: '&',
  };
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    const token = entity.toLowerCase();
    if (token.startsWith('#x')) return String.fromCodePoint(parseInt(token.slice(2), 16));
    if (token.startsWith('#')) return String.fromCodePoint(Number(token.slice(1)));
    // `amp` is listed last in `named` on purpose but resolved here like any other: decoding is
    // a single pass, so an already-decoded `&` cannot be re-consumed.
    return named[token] ?? match;
  });
};

export const parseRabotaSearchHtml = (html: string): JobVacancy[] | null => {
  const m = html.match(INITIAL_STATE_RE);
  if (!m) return null;

  let state: unknown;
  try {
    state = JSON.parse(decodeHtmlEntities(m[1]));
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
