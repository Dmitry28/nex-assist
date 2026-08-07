import { Injectable, Logger } from '@nestjs/common';
import { decodeHtmlEntities } from '../../common/utils/html-entities';
import { BROWSER_USER_AGENT } from '../../common/utils/scraping';
import {
  GRODNORIK_FETCH_TIMEOUT_MS,
  GRODNORIK_MAX_HTML_SIZE_BYTES,
  GRODNORIK_NOTICE_PATH,
} from './constants';
import type { GrodnorikNotice } from './dto/grodnorik-notice.dto';

/**
 * Scrapes auction notices from grodnorik.gov.by.
 *
 * The page is fully server-rendered, so a plain fetch is enough — no Puppeteer.
 * All notices live in one freeform WYSIWYG block, so anchors are matched by their file
 * path rather than by any container class, which the CMS editor changes constantly.
 *
 * Never throws: a failed fetch returns an empty array and the caller keeps the previous
 * snapshot, so a site outage can never look like "all notices removed".
 */
@Injectable()
export class GrodnorikParserService {
  private readonly logger = new Logger(GrodnorikParserService.name);

  async fetchNotices(url: string): Promise<GrodnorikNotice[]> {
    const html = await this.fetchHtml(url);
    if (!html) return [];

    const notices = parseNotices(html, url);
    this.logger.log(`grodnorik.gov.by: found ${notices.length} notice(s)`);
    return notices;
  }

  private async fetchHtml(url: string): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GRODNORIK_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': BROWSER_USER_AGENT, 'Accept-Language': 'ru-RU,ru;q=0.9' },
      });
      if (!res.ok) {
        this.logger.warn(`HTTP ${res.status} for ${url}`);
        return null;
      }
      const text = await res.text();
      if (text.length > GRODNORIK_MAX_HTML_SIZE_BYTES) {
        this.logger.warn(`Response too large (${text.length} bytes) for ${url} — skipping`);
        return null;
      }
      return text;
    } catch (error) {
      this.logger.error(`Failed to fetch ${url}`, error);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ─── Pure parsing helpers ─────────────────────────────────────────────────────

const ANCHOR_RE = /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

/** Month names as they appear in the notice titles (genitive case). */
const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

const pad2 = (value: number): string => String(value).padStart(2, '0');

/**
 * Extract the auction date from a notice title as `ДД.ММ.ГГГГ`.
 * Titles use either a numeric date ("ИНФОРМАЦИЯ О ПРОВЕДЕНИИ 30.06.2025 АУКЦИОНА")
 * or a spelled-out month ("Извещение о проведении 5 августа 2026 г."), sometimes in caps.
 * Returns undefined when the title carries no date at all.
 */
export const parseNoticeDate = (title: string): string | undefined => {
  const numeric = title.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (numeric) return `${pad2(+numeric[1])}.${pad2(+numeric[2])}.${numeric[3]}`;

  const spelled = title
    .toLowerCase()
    .match(new RegExp(`(\\d{1,2})\\s+(${MONTHS.join('|')})\\s+(\\d{4})`));
  if (!spelled) return undefined;
  return `${pad2(+spelled[1])}.${pad2(MONTHS.indexOf(spelled[2]) + 1)}.${spelled[3]}`;
};

/** Strip tags, decode entities and collapse whitespace of an anchor's inner HTML. */
const toPlainText = (innerHtml: string): string =>
  decodeHtmlEntities(innerHtml.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Last-resort title for a notice whose anchor holds no text (the editor sometimes wraps a
 * bare `<hr>` in a link). The file name still says what the auction is about, so the notice
 * is reported rather than silently dropped.
 */
const titleFromLink = (link: string): string =>
  decodeURIComponent(link.split('/').pop() ?? link).replace(/\.[a-z]+$/i, '');

/**
 * Parse all auction notices out of the page HTML.
 *
 * The same file is often linked more than once (one anchor holds the title, a sibling wraps a
 * separator and holds nothing), so notices are keyed by link and the longest title wins.
 */
export const parseNotices = (html: string, pageUrl: string): GrodnorikNotice[] => {
  const titleByLink = new Map<string, string>();

  for (const [, href, innerHtml] of html.matchAll(ANCHOR_RE)) {
    if (!href.includes(GRODNORIK_NOTICE_PATH)) continue;

    let link: string;
    try {
      link = new URL(href, pageUrl).href;
    } catch {
      continue;
    }

    const title = toPlainText(innerHtml);
    if (title.length > (titleByLink.get(link)?.length ?? -1)) titleByLink.set(link, title);
  }

  return [...titleByLink].map(([link, rawTitle]) => {
    const title = rawTitle || titleFromLink(link);
    const auctionDate = parseNoticeDate(title);
    return auctionDate ? { link, title, auctionDate } : { link, title };
  });
};
