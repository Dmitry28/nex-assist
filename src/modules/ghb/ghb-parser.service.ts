import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BROWSER_USER_AGENT } from '../../common/utils/scraping';
import { FETCH_TIMEOUT_MS, MAX_HTML_SIZE_BYTES } from './constants';
import type { GhbItemType, GhbListing } from './dto/ghb-listing.dto';

/**
 * Matches an item anchor inside the price-list page:
 *   <h3>...<a href="https://ghb.by/ru/construction/{nedvizhimost|nedvizhimost-dogovor}/{id}/">TITLE</a>...</h3>
 *
 * Apartments live under /nedvizhimost-dogovor/, offices under /nedvizhimost/.
 * Title content may contain inline tags (e.g. <strong>) which we strip later.
 */
const ITEM_ANCHOR_RE =
  /<h3[^>]*>\s*<a\s+href="https?:\/\/(?:www\.)?ghb\.by\/ru\/construction\/(nedvizhimost(?:-dogovor)?)\/(\d+)\/?"[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/gi;

/**
 * Numeric price cell in BYN/m², e.g. "3 500", "3 150,0", "4 200".
 * Requires a thousand separator (space) — excludes plain 4-digit years like "2026".
 */
const PRICE_CELL_RE = /\b\d{1,2}[\s ]+\d{3}(?:[.,]\d+)?\b/g;

/** Inner table block inside one item's section — that's where price cells live. */
const INNER_TABLE_RE = /<table\b[\s\S]*?<\/table>/gi;

/** Single paragraph — used to scan section paragraphs one by one. */
const PARAGRAPH_RE = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;

const REGISTRATION_KEYWORD_RE =
  /(?:Онлайн|онлайн)\s+регистрац|Дата\s+начала\s+продаж|бронирование\s+квартир/i;

const OFFICES_SECTION_MARKER = 'ОФИСНЫЕ ПОМЕЩЕНИЯ';

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

/**
 * Parse "3 500,0" / "4 200" → 3500 / 4200. Decimal part is dropped —
 * BYN/m² prices are rounded to whole rubles for the diff.
 */
const parsePriceCell = (raw: string): number | undefined => {
  const normalized = raw.replace(/[\s ]+/g, '').replace(',', '.');
  const value = Number(normalized);
  if (!isFinite(value) || value <= 0) return undefined;
  return Math.round(value);
};

@Injectable()
export class GhbParserService {
  private readonly logger = new Logger(GhbParserService.name);

  constructor(private readonly config: ConfigService) {}

  async fetch(): Promise<GhbListing[]> {
    const url = this.config.getOrThrow<string>('ghb.priceListUrl');
    const html = await this.fetchText(url);
    if (!html) return [];
    return parsePriceListHtml(html);
  }

  private async fetchText(url: string): Promise<string | null> {
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
      const text = await res.text();
      if (text.length > MAX_HTML_SIZE_BYTES) {
        this.logger.warn(`Response too large (${text.length} bytes) for ${url} — skipping`);
        return null;
      }
      return text;
    } catch (err) {
      this.logger.error(`Failed to fetch ${url}`, err);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ─── Pure parsing helpers ─────────────────────────────────────────────────────

interface AnchorMatch {
  index: number;
  endIndex: number;
  id: number;
  type: GhbItemType;
  title: string;
}

const collectAnchors = (html: string): AnchorMatch[] => {
  const anchors: AnchorMatch[] = [];
  for (const m of html.matchAll(ITEM_ANCHOR_RE)) {
    const pathSegment = m[1];
    const id = Number(m[2]);
    if (!Number.isFinite(id)) continue;
    const title = stripTags(m[3]);
    if (!title) continue;
    anchors.push({
      index: m.index ?? 0,
      endIndex: (m.index ?? 0) + m[0].length,
      id,
      type: pathSegment === 'nedvizhimost-dogovor' ? 'apartment' : 'office',
      title,
    });
  }
  return anchors;
};

const extractOnlineRegistration = (section: string): string | undefined => {
  for (const m of section.matchAll(PARAGRAPH_RE)) {
    const text = stripTags(m[1]);
    if (text && REGISTRATION_KEYWORD_RE.test(text)) return text;
  }
  return undefined;
};

/**
 * Extract min/max BYN/m² from the inner price table(s) of one item's section.
 * Only digits inside <table>...</table> are considered — that excludes years
 * and CSS width values scattered through paragraph text.
 */
const extractPriceRange = (section: string): { min: number; max: number } | undefined => {
  const prices: number[] = [];
  for (const tableMatch of section.matchAll(INNER_TABLE_RE)) {
    for (const cellMatch of tableMatch[0].matchAll(PRICE_CELL_RE)) {
      const value = parsePriceCell(cellMatch[0]);
      if (value !== undefined) prices.push(value);
    }
  }
  if (prices.length === 0) return undefined;
  return { min: Math.min(...prices), max: Math.max(...prices) };
};

const normalizeUrl = (id: number, type: GhbItemType): string => {
  const segment = type === 'apartment' ? 'nedvizhimost-dogovor' : 'nedvizhimost';
  return `https://ghb.by/ru/construction/${segment}/${id}/`;
};

/**
 * Parse the full ghb.by price-list HTML page into a list of items.
 * Exported for unit tests — pure function with no side effects.
 */
export const parsePriceListHtml = (html: string): GhbListing[] => {
  const anchors = collectAnchors(html);
  if (anchors.length === 0) return [];

  const officesMarkerIdx = html.indexOf(OFFICES_SECTION_MARKER);

  const listings: GhbListing[] = [];
  for (const [i, anchor] of anchors.entries()) {
    // Section text spans from this anchor's end to the next anchor's start.
    const sectionEnd = i + 1 < anchors.length ? anchors[i + 1].index : html.length;
    const section = html.slice(anchor.endIndex, sectionEnd);

    // Re-classify by position: anchors after the "ОФИСНЫЕ ПОМЕЩЕНИЯ" marker are offices
    // even if the URL path is /nedvizhimost-dogovor/, and vice versa.
    const type: GhbItemType =
      officesMarkerIdx >= 0 && anchor.index >= officesMarkerIdx ? 'office' : anchor.type;

    const range = extractPriceRange(section);
    listings.push({
      url: normalizeUrl(anchor.id, type),
      id: anchor.id,
      type,
      title: anchor.title,
      onlineRegistration: extractOnlineRegistration(section),
      minPricePerM2Byn: range?.min,
      maxPricePerM2Byn: range?.max,
    });
  }

  return listings;
};
