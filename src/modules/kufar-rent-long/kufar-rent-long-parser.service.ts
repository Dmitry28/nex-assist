import { Injectable, Logger } from '@nestjs/common';
import { BROWSER_USER_AGENT } from '../../common/utils/scraping';
import { FETCH_TIMEOUT_MS, IMAGE_CDN_BASE, MAX_HTML_SIZE_BYTES } from './constants';
import type { KufarRentLongListing } from './dto/kufar-rent-long-listing.dto';

/** Raw ad shape from re.kufar.by `__NEXT_DATA__` JSON. Same shape as the for-sale `kufar` module. */
interface RawAd {
  ad_id: number;
  subject: string;
  /** Price in 1/100 BYN ("85000" → 850 BYN). */
  price_byn?: string;
  /** Price in 1/100 USD ("30870" → 308.70 USD). */
  price_usd?: string;
  list_time: string;
  images?: Array<{ path: string }>;
  /** v = raw code/key; vl = human-readable label (preferred for display). */
  ad_parameters?: Array<{ p: string; v: unknown; vl?: unknown }>;
  account_parameters?: Array<{ p: string; v: unknown; vl?: unknown }>;
}

const toNum = (v: unknown): number | undefined => {
  // Some kufar params arrive wrapped in a single-element array (e.g. `floor: [5]`).
  // Unwrap before coercing.
  const value: unknown = Array.isArray(v) ? (v as unknown[])[0] : v;
  if (typeof value === 'number' && isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    return isFinite(n) ? n : undefined;
  }
  return undefined;
};

const toStr = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

const getParam = (
  params: Array<{ p: string; v: unknown; vl?: unknown }> | undefined,
  key: string,
  field: 'v' | 'vl' = 'v',
): unknown => params?.find(p => p.p === key)?.[field];

/**
 * Fetches re.kufar.by long-term rental listings by parsing the `__NEXT_DATA__`
 * JSON embedded in the SSR HTML.
 *
 * All listing data is in the initial HTML response under
 * `props.initialState.listing.ads` (or `props.pageProps.initialState.listing.ads`).
 * Mirrors the for-sale `kufar` module's parsing approach. Pagination is not needed
 * for our narrow bbox — at most a handful of listings, all fit on page 1.
 */
@Injectable()
export class KufarRentLongParserService {
  private readonly logger = new Logger(KufarRentLongParserService.name);

  async fetchListings(url: string): Promise<KufarRentLongListing[]> {
    const html = await this.fetchHtml(url);
    if (!html) return [];

    const ads = this.extractAds(html);
    this.logger.log(`Parsed ${ads.length} ad(s) from __NEXT_DATA__`);

    return ads.map(mapAd);
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

  private extractAds(html: string): RawAd[] {
    const openTag = '<script id="__NEXT_DATA__" type="application/json">';
    const start = html.indexOf(openTag);
    if (start === -1) {
      this.logger.warn('__NEXT_DATA__ not found in page HTML');
      return [];
    }
    const contentStart = start + openTag.length;
    const end = html.indexOf('</script>', contentStart);
    if (end === -1) {
      this.logger.warn('__NEXT_DATA__ closing tag not found in page HTML');
      return [];
    }

    try {
      const nextData = JSON.parse(html.slice(contentStart, end)) as Record<string, unknown>;
      const props = nextData?.props as Record<string, unknown> | undefined;
      const initialState =
        (props?.pageProps as Record<string, unknown> | undefined)?.initialState ??
        props?.initialState;
      const listing = (initialState as Record<string, unknown> | undefined)?.listing as
        | Record<string, unknown>
        | undefined;
      const ads = (listing?.ads as RawAd[] | undefined) ?? [];
      return Array.isArray(ads) ? ads : [];
    } catch (err) {
      this.logger.error('Failed to parse __NEXT_DATA__ JSON', err);
      return [];
    }
  }
}

// ─── Pure parsing helpers ─────────────────────────────────────────────────────

export const mapAd = (ad: RawAd): KufarRentLongListing => {
  // kufar stores prices as integers in 1/100 of the currency unit
  const rawByn = ad.price_byn ? parseInt(ad.price_byn, 10) : 0;
  const rawUsd = ad.price_usd ? parseInt(ad.price_usd, 10) : 0;
  const priceByn = rawByn > 0 ? Math.round(rawByn / 100) : undefined;
  const priceUsd = rawUsd > 0 ? Math.round(rawUsd / 100) : undefined;

  const address = toStr(getParam(ad.account_parameters, 'address'));

  const rooms = toNum(getParam(ad.ad_parameters, 'rooms'));
  const area = toNum(getParam(ad.ad_parameters, 'size'));
  const floor = toNum(getParam(ad.ad_parameters, 'floor'));
  const totalFloors = toNum(getParam(ad.ad_parameters, 're_number_floors'));

  const repair = toStr(getParam(ad.ad_parameters, 'flat_repair', 'vl'));
  const furnished = toStr(getParam(ad.ad_parameters, 'flat_furnished', 'vl'));
  const prepayment = toStr(getParam(ad.ad_parameters, 'flat_rent_prepayment', 'vl'));

  const images = (ad.images ?? []).map(img => `${IMAGE_CDN_BASE}/${img.path}`);

  return {
    adId: ad.ad_id,
    link: `https://re.kufar.by/vi/${ad.ad_id}`,
    title: ad.subject,
    priceByn,
    priceUsd,
    address,
    rooms,
    area,
    floor,
    totalFloors,
    repair,
    furnished,
    prepayment,
    listTime: ad.list_time,
    images,
  };
};
