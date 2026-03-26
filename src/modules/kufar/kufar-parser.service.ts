import { Injectable, Logger } from '@nestjs/common';
import type { KufarListing } from './dto/kufar-listing.dto';
import { BROWSER_USER_AGENT } from '../../common/utils/scraping';
import {
  FETCH_TIMEOUT_MS,
  IMAGE_CDN_BASE,
  LOOKBACK_HOURS,
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
 * Fetches Kufar real-estate search results by parsing the __NEXT_DATA__ JSON
 * embedded in the server-side-rendered HTML.
 *
 * No Puppeteer needed — all listing data is available in the initial HTML response.
 * Follows cursor-based pagination and stops once listings are older than LOOKBACK_HOURS.
 */
@Injectable()
export class KufarParserService {
  private readonly logger = new Logger(KufarParserService.name);

  async fetchFeed(url: string): Promise<{ listings: KufarListing[]; truncated: boolean }> {
    const allListings: KufarListing[] = [];
    let currentUrl = url;
    let truncated = false;

    // Cutoff is fixed for the entire run so pagination decisions are consistent
    const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);
    const isRecent = (listTime: string) => new Date(listTime) >= cutoff;

    for (let page = 1; page <= MAX_PAGES; page++) {
      const html = await this.fetchHtml(currentUrl);
      if (!html) break;

      const { ads, pagination } = this.extractPageData(html);

      if (ads.length === 0) {
        this.logger.warn(`Page ${page}: no ads found — stopping pagination`);
        break;
      }

      const recentAds = ads.filter(ad => isRecent(ad.list_time));
      allListings.push(...recentAds.map(mapListing));

      this.logger.log(
        `Page ${page}: ${ads.length} ads total, ${recentAds.length} within ${LOOKBACK_HOURS}h window`,
      );

      // Stop paginating if the oldest ad on this page is outside our window
      if (!isRecent(ads[ads.length - 1].list_time)) break;

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
      // Cheap early exit before buffering the body
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
        | Record<string, unknown>
        | undefined;

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
    listTime: ad.list_time,
    images,
  };
};
