import { Injectable, Logger } from '@nestjs/common';
import type { KufarListing } from './dto/kufar-listing.dto';
import { EscalatingHtmlFetcher } from '../../common/scraping/escalating-html-fetcher';
import { sleep } from '../../common/utils/sleep';

/** A usable Kufar page always embeds the Next.js payload the parser reads. */
const hasNextData = (html: string): boolean => html.includes('__NEXT_DATA__');
import {
  FETCH_TIMEOUT_MS,
  IMAGE_CDN_BASE,
  INTER_PAGE_DELAY_MS,
  MAX_HTML_SIZE_BYTES,
  MAX_PAGES,
} from './constants';

/** Raw ad shape from Kufar's __NEXT_DATA__ JSON. */
export interface RawAd {
  ad_id: number;
  subject: string;
  body_short?: string;
  price_byn?: string;
  price_usd?: string;
  list_time: string;
  images?: Array<{ path: string }>;
  /** v = raw code/key; vl = human-readable label (preferred for display). */
  ad_parameters?: Array<{ p: string; v: unknown; vl?: unknown }>;
  account_parameters?: Array<{ p: string; v: unknown; vl?: unknown }>;
}

/** Pagination entry from __NEXT_DATA__. */
interface RawPaginationEntry {
  label: string;
  token: string | null;
}

// ─── Runtime coercions ────────────────────────────────────────────────────────

/** Safely coerce an unknown API value to number, or undefined if not numeric. */
export const toNum = (v: unknown): number | undefined => {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return isFinite(n) ? n : undefined;
  }
  return undefined;
};

/** Safely coerce an unknown API value to a non-empty string, or undefined. */
export const toStr = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

/** Look up a parameter value by key from a Kufar ad_parameters / account_parameters array. */
export const getParam = (
  params: Array<{ p: string; v: unknown; vl?: unknown }> | undefined,
  key: string,
  field: 'v' | 'vl' = 'v',
): unknown => params?.find(p => p.p === key)?.[field];

/**
 * Parse the `coordinates` ad parameter. Kufar stores it as `[longitude, latitude]`
 * (format code `gbx`), with longitude first. Returns undefined for malformed or
 * out-of-range values.
 */
export const parseCoordinates = (v: unknown): { lat: number; lon: number } | undefined => {
  if (!Array.isArray(v) || v.length < 2) return undefined;
  const lon = toNum(v[0]);
  const lat = toNum(v[1]);
  if (lon === undefined || lat === undefined) return undefined;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  return { lat, lon };
};

/**
 * Fetches Kufar real-estate search results by parsing the __NEXT_DATA__ JSON
 * embedded in the server-side-rendered HTML.
 *
 * No Puppeteer needed — all listing data is available in the initial HTML response.
 * Follows cursor-based pagination until the feed's full inventory has been read.
 */
@Injectable()
export class KufarParserService {
  private readonly logger = new Logger(KufarParserService.name);

  constructor(private readonly html: EscalatingHtmlFetcher) {}

  /**
   * Fetches the feed's entire current inventory.
   *
   * There is deliberately no time filter. Kufar's `list_time` is the publish/bump time, not
   * a "last modified" stamp: a seller can cut the price and `list_time` stays put. Measured
   * against a 2-day-old snapshot — so recent edits could not have aged out — all 56 genuine
   * price changes carried a `list_time` older than 48 h, as did 74 of 85 listings the feed
   * had never recorded. A daily 48 h window would have caught none of them.
   */
  async fetchFeed(url: string): Promise<{ listings: KufarListing[]; truncated: boolean }> {
    const allListings: KufarListing[] = [];
    let currentUrl = url;
    let truncated = false;

    for (let page = 1; page <= MAX_PAGES; page++) {
      // Pace pagination — Kufar returns 429 on sustained back-to-back page fetches.
      if (page > 1) await sleep(INTER_PAGE_DELAY_MS);

      const html = await this.html.fetch(currentUrl, {
        label: 'kufar',
        // A body without the Next.js payload is a challenge or error shell, not the listing
        // page — treating it as success would stop the ladder at a useless response.
        isUsable: hasNextData,
        timeoutMs: FETCH_TIMEOUT_MS,
        maxBytes: MAX_HTML_SIZE_BYTES,
      });
      if (!html) {
        // Any failed page leaves the inventory incomplete — including page 1, where the
        // result would otherwise read as "the feed is genuinely empty".
        truncated = true;
        this.logger.warn(`Page ${page}: fetch failed — stopping pagination`);
        break;
      }

      const { ads, pagination } = this.extractPageData(html);

      if (ads.length === 0) {
        this.logger.warn(`Page ${page}: no ads found — stopping pagination`);
        break;
      }

      allListings.push(...ads.map(mapListing));

      this.logger.log(`Page ${page}: ${ads.length} ads (running total ${allListings.length})`);

      const nextToken = pagination.find(p => p.label === 'next')?.token;
      if (!nextToken) break;

      if (page === MAX_PAGES) {
        // Next token exists but we've hit the page cap — signal truncation to the caller
        truncated = true;
        this.logger.warn(`Reached MAX_PAGES (${MAX_PAGES}) — feed may have more listings`);
        break;
      }

      currentUrl = this.buildNextPageUrl(url, nextToken);
    }

    this.logger.log(`Fetched ${allListings.length} listings (full inventory)`);
    return { listings: allListings, truncated };
  }

  private extractPageData(html: string): { ads: RawAd[]; pagination: RawPaginationEntry[] } {
    // Use positional search instead of regex — the JSON can contain '<' characters
    // (e.g. in titles or descriptions), which would truncate a [^<]+ pattern.
    const openTag = '<script id="__NEXT_DATA__" type="application/json">';
    const start = html.indexOf(openTag);
    if (start === -1) {
      this.logger.warn('__NEXT_DATA__ not found in page HTML');
      return { ads: [], pagination: [] };
    }
    const contentStart = start + openTag.length;
    const end = html.indexOf('</script>', contentStart);
    if (end === -1) {
      this.logger.warn('__NEXT_DATA__ closing tag not found in page HTML');
      return { ads: [], pagination: [] };
    }

    try {
      const nextData = JSON.parse(html.slice(contentStart, end)) as Record<string, unknown>;
      // Kufar stores Redux state under props.pageProps.initialState or props.initialState
      const props = nextData?.props as Record<string, unknown> | undefined;
      const initialState =
        (props?.pageProps as Record<string, unknown> | undefined)?.initialState ??
        props?.initialState;

      const listing = (initialState as Record<string, unknown> | undefined)?.listing as
        Record<string, unknown> | undefined;

      const ads = (listing?.ads as RawAd[] | undefined) ?? [];
      const pagination = (listing?.pagination as RawPaginationEntry[] | undefined) ?? [];

      return { ads, pagination };
    } catch (err) {
      this.logger.error('Failed to parse __NEXT_DATA__ JSON', err);
      return { ads: [], pagination: [] };
    }
  }

  /** Append (or replace) the cursor param on the original search URL. */
  private buildNextPageUrl(baseUrl: string, token: string): string {
    const url = new URL(baseUrl);
    url.searchParams.set('cursor', token);
    return url.toString();
  }
}

// ─── Pure parsing helpers ─────────────────────────────────────────────────────

export const mapListing = (ad: RawAd): KufarListing => {
  // Kufar stores prices as integers in 1/100 of the currency unit (e.g. 10950000 → 109500 BYN)
  const rawByn = ad.price_byn ? parseInt(ad.price_byn, 10) : 0;
  const rawUsd = ad.price_usd ? parseInt(ad.price_usd, 10) : 0;
  const priceByn = rawByn > 0 ? Math.round(rawByn / 100) : undefined;
  const priceUsd = rawUsd > 0 ? Math.round(rawUsd / 100) : undefined;

  const address = toStr(getParam(ad.account_parameters, 'address'));
  const seller = toStr(getParam(ad.account_parameters, 'name'));

  // 'size' = building area m²; 'size_area' = land/plot area in sotki
  const area = toNum(getParam(ad.ad_parameters, 'size'));
  const plotArea = toNum(getParam(ad.ad_parameters, 'size_area'));
  const rooms = toNum(getParam(ad.ad_parameters, 'rooms'));
  const yearBuilt = toNum(getParam(ad.ad_parameters, 'year_built'));

  const propertyType =
    toStr(getParam(ad.ad_parameters, 'garage_type', 'vl')) ??
    toStr(getParam(ad.ad_parameters, 'house_type_for_sell', 'vl')) ??
    toStr(getParam(ad.ad_parameters, 'land_type', 'vl'));

  // Collect feature labels (improvements, heating, water, property rights, outbuildings)
  const featureKeys = [
    'garage_improvements',
    'garage_parking_type',
    're_heating',
    're_water',
    're_property_rights',
    're_outbuildings',
  ];
  const features: string[] = [];
  for (const key of featureKeys) {
    const vl = getParam(ad.ad_parameters, key, 'vl');
    if (vl == null) continue;
    if (Array.isArray(vl)) {
      features.push(...vl.map(toStr).filter((s): s is string => s !== undefined));
    } else {
      const s = toStr(vl);
      if (s) features.push(s);
    }
  }

  const images = (ad.images ?? []).map(img => `${IMAGE_CDN_BASE}/${img.path}`);

  const coordinates = parseCoordinates(getParam(ad.ad_parameters, 'coordinates'));

  return {
    adId: ad.ad_id,
    // ad_link from the API is not used — we reconstruct from ad_id for a stable canonical URL
    link: `https://re.kufar.by/vi/${ad.ad_id}`,
    title: ad.subject,
    description: ad.body_short || undefined,
    priceByn,
    priceUsd,
    address,
    area,
    plotArea,
    rooms,
    yearBuilt,
    seller,
    propertyType,
    features: features.length > 0 ? features : undefined,
    coordinates,
    listTime: ad.list_time,
    images,
  };
};
