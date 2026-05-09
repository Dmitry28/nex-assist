import { Injectable, Logger } from '@nestjs/common';
import { BROWSER_USER_AGENT } from '../../common/utils/scraping';
import {
  CURRENCY_BYN,
  CURRENCY_USD,
  FETCH_TIMEOUT_MS,
  LOOKBACK_HOURS,
  MAX_HTML_SIZE_BYTES,
  MAX_PAGES,
  listingLink,
} from './constants';
import type { RealtListing } from './dto/realt-listing.dto';

/** Raw object shape from realt.by's __NEXT_DATA__ JSON. */
export interface RawObject {
  /** Numeric stable id used in canonical URLs. */
  code: number;
  uuid: string;
  title?: string | null;
  headline?: string | null;
  description?: string | null;
  /** ISO 8601 with timezone offset (e.g. "2026-05-08T18:56:46+03:00"). */
  updatedAt: string;
  createdAt?: string;
  /** All available currency conversions, keyed by ISO 4217 numeric code. */
  priceRates?: Record<string, number>;
  /** Total building area in m² (houses, dachas, garages). */
  areaTotal?: number | null;
  /** Living area in m² (houses, dachas). */
  areaLiving?: number | null;
  /** Kitchen area in m² (houses, dachas). */
  areaKitchen?: number | null;
  /** Plot area in sotki (plots, houses, dachas with land). */
  areaLand?: number | null;
  /** Number of rooms (houses). */
  rooms?: number | null;
  /** Year built (houses, dachas, garages). */
  buildingYear?: number | null;
  /** Number of storeys in the building. */
  storeys?: number | null;
  /** Floor (apartments — not used for houses/plots). */
  storey?: number | null;
  /** Number of levels in the unit. */
  levels?: number | null;
  address?: string | null;
  townName?: string | null;
  streetName?: string | null;
  contactName?: string | null;
  /** Pre-built CDN URLs (no path expansion needed). */
  images?: string[];
}

/** Pagination block from __NEXT_DATA__. */
interface RawPagination {
  page: number;
  pageSize: number;
  totalCount: number;
}

/**
 * Fetches realt.by search results by parsing the __NEXT_DATA__ JSON
 * embedded in the server-side-rendered HTML.
 *
 * No Puppeteer needed — all listing data is available in the initial HTML response.
 * Pagination is page-based: `?page=N` until totalCount is exhausted or MAX_PAGES is hit.
 */
@Injectable()
export class RealtParserService {
  private readonly logger = new Logger(RealtParserService.name);

  async fetchFeed(
    url: string,
    linkPath: string,
  ): Promise<{ listings: RealtListing[]; truncated: boolean }> {
    const allListings: RealtListing[] = [];
    let truncated = false;

    // Cutoff is fixed for the entire run so pagination decisions are consistent
    const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);
    const isRecent = (updatedAt: string): boolean => new Date(updatedAt) >= cutoff;

    for (let page = 1; page <= MAX_PAGES; page++) {
      const pageUrl = page === 1 ? url : this.buildPageUrl(url, page);
      const html = await this.fetchHtml(pageUrl);
      if (!html) break;

      const { objects, pagination } = this.extractPageData(html);

      if (objects.length === 0) {
        this.logger.warn(`Page ${page}: no objects found — stopping pagination`);
        break;
      }

      const recentObjects = objects.filter(o => isRecent(o.updatedAt));
      allListings.push(...recentObjects.map(o => mapListing(o, linkPath)));

      this.logger.log(
        `Page ${page}: ${objects.length} objects total, ${recentObjects.length} within ${LOOKBACK_HOURS}h window (totalCount=${pagination?.totalCount ?? '?'})`,
      );

      if (!pagination) break;
      if (page * pagination.pageSize >= pagination.totalCount) break;

      if (page === MAX_PAGES) {
        truncated = true;
        this.logger.warn(`Reached MAX_PAGES (${MAX_PAGES}) — feed may have more listings`);
        break;
      }
    }

    this.logger.log(`Fetched ${allListings.length} listings within ${LOOKBACK_HOURS}h window`);
    return { listings: allListings, truncated };
  }

  private async fetchHtml(url: string): Promise<string | null> {
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
      const contentLength = Number(res.headers.get('content-length'));
      if (contentLength > MAX_HTML_SIZE_BYTES) {
        this.logger.warn(`Content-Length ${contentLength} exceeds limit for ${url} — skipping`);
        return null;
      }
      const html = await res.text();
      if (html.length > MAX_HTML_SIZE_BYTES) {
        this.logger.warn(`Response too large (${html.length} bytes) for ${url} — skipping`);
        return null;
      }
      return html;
    } catch (err) {
      this.logger.error(`Failed to fetch ${url}`, err);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private extractPageData(html: string): {
    objects: RawObject[];
    pagination: RawPagination | null;
  } {
    // Use positional search instead of regex — JSON can contain '<' characters
    // (e.g. in titles or descriptions), which would truncate a [^<]+ pattern.
    const openTag = '<script id="__NEXT_DATA__" type="application/json">';
    const start = html.indexOf(openTag);
    if (start === -1) {
      this.logger.warn('__NEXT_DATA__ not found in page HTML');
      return { objects: [], pagination: null };
    }
    const contentStart = start + openTag.length;
    const end = html.indexOf('</script>', contentStart);
    if (end === -1) {
      this.logger.warn('__NEXT_DATA__ closing tag not found in page HTML');
      return { objects: [], pagination: null };
    }

    try {
      const nextData = JSON.parse(html.slice(contentStart, end)) as Record<string, unknown>;
      const props = nextData?.props as Record<string, unknown> | undefined;
      const pageProps = props?.pageProps as Record<string, unknown> | undefined;

      const objects = (pageProps?.objects as RawObject[] | undefined) ?? [];
      const pagination = (pageProps?.pagination as RawPagination | undefined) ?? null;

      return { objects, pagination };
    } catch (err) {
      this.logger.error('Failed to parse __NEXT_DATA__ JSON', err);
      return { objects: [], pagination: null };
    }
  }

  /** Append (or replace) the page param on the original search URL. */
  private buildPageUrl(baseUrl: string, page: number): string {
    const url = new URL(baseUrl);
    url.searchParams.set('page', String(page));
    return url.toString();
  }
}

// ─── Pure parsing helpers ─────────────────────────────────────────────────────

/** Coerce a numeric value to a positive integer, or undefined. */
const toPositiveInt = (n: number | undefined): number | undefined =>
  typeof n === 'number' && isFinite(n) && n > 0 ? Math.round(n) : undefined;

/** Pass through a positive number unchanged (preserves decimals like 9.84 sotki, 114.6 m²). */
const toPositiveNum = (n: number | null | undefined): number | undefined =>
  typeof n === 'number' && isFinite(n) && n > 0 ? n : undefined;

/** Coerce a non-empty trimmed string, or undefined. */
const toStr = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

export const mapListing = (obj: RawObject, linkPath: string): RealtListing => {
  const priceUsd = toPositiveInt(obj.priceRates?.[CURRENCY_USD]);
  const priceByn = toPositiveInt(obj.priceRates?.[CURRENCY_BYN]);

  // Prefer explicit title; otherwise build from town + street; otherwise generic fallback.
  const titleParts = [toStr(obj.townName), toStr(obj.streetName)].filter(
    (s): s is string => s !== undefined,
  );
  const title =
    toStr(obj.title) ?? (titleParts.length > 0 ? titleParts.join(', ') : undefined) ?? 'Объявление';

  const description = toStr(obj.headline) ?? toStr(obj.description);
  const address = toStr(obj.address);
  const seller = toStr(obj.contactName);

  return {
    adId: obj.code,
    uuid: obj.uuid,
    link: listingLink(linkPath, obj.code),
    title,
    description,
    priceByn,
    priceUsd,
    address,
    area: toPositiveNum(obj.areaTotal),
    areaLiving: toPositiveNum(obj.areaLiving),
    areaKitchen: toPositiveNum(obj.areaKitchen),
    plotArea: toPositiveNum(obj.areaLand),
    rooms: toPositiveInt(obj.rooms ?? undefined),
    yearBuilt: toPositiveInt(obj.buildingYear ?? undefined),
    storeys: toPositiveInt(obj.storeys ?? undefined),
    levels: toPositiveInt(obj.levels ?? undefined),
    seller,
    listTime: obj.updatedAt,
    images: obj.images ?? [],
  };
};
