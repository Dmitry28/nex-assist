import { Injectable, Logger } from '@nestjs/common';
import { BROWSER_USER_AGENT } from '../../common/utils/scraping';
import { FETCH_TIMEOUT_MS, MAX_HTML_SIZE_BYTES } from './constants';
import type { KufarRentFlatListing } from './dto/kufar-rent-flat-listing.dto';

/** Raw rentalObject shape from travel.kufar.by `__NEXT_DATA__` JSON. */
interface RawRentalObject {
  adId: number;
  subject?: string;
  address?: string;
  /** Price in BYN minor units (kopeks). 26600 → 266 BYN/night. */
  price?: number;
  image?: string;
  images?: { listings?: string[]; gallery?: string[] };
  rooms?: number;
  /** `size` is the number of bedrooms; not the m² area, despite the name. */
  size?: number;
  area?: number;
  personsMax?: number;
  accommodationType?: number | string;
  isHotel?: boolean;
  isSuperhost?: boolean;
  rating?: number;
  ratingScoresCount?: number;
  listTime?: string;
  selfUrl?: string;
}

/**
 * Human labels for kufar's numeric `accommodationType` codes. Discovered from live data:
 *   1 — Квартира, 2 — Дом, 3 — Коттедж, 4 — Комната, 5 — Отель/Апарт-отель, 6 — Хостел
 * Fallback to the raw code as a string if a new value appears.
 */
const ACCOMMODATION_TYPE_LABELS: Record<number, string> = {
  1: 'Квартира',
  2: 'Дом',
  3: 'Коттедж',
  4: 'Комната',
  5: 'Отель',
  6: 'Хостел',
};

/**
 * Fetches travel.kufar.by short-term rental listings by parsing the `__NEXT_DATA__`
 * JSON embedded in the server-rendered HTML.
 *
 * All listing data is in the initial HTML response under
 * `props.initialState.listing.rentalObjects` — no Puppeteer or client-side hydration needed.
 * The XHRs that fire after page load (auth-bypass/v2/search/count, activities) only update
 * counters and unrelated sections.
 */
@Injectable()
export class KufarRentFlatParserService {
  private readonly logger = new Logger(KufarRentFlatParserService.name);

  async fetchListings(url: string): Promise<KufarRentFlatListing[]> {
    const html = await this.fetchHtml(url);
    if (!html) return [];

    const rentalObjects = this.extractRentalObjects(html);
    this.logger.log(`Parsed ${rentalObjects.length} rentalObject(s) from __NEXT_DATA__`);

    return rentalObjects.map(mapRentalObject);
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

  private extractRentalObjects(html: string): RawRentalObject[] {
    // Positional search — the JSON body can contain '<' characters in titles/descriptions
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
      const initialState = props?.initialState as Record<string, unknown> | undefined;
      const listing = initialState?.listing as Record<string, unknown> | undefined;
      const objects = listing?.rentalObjects as RawRentalObject[] | undefined;
      return Array.isArray(objects) ? objects : [];
    } catch (err) {
      this.logger.error('Failed to parse __NEXT_DATA__ JSON', err);
      return [];
    }
  }
}

// ─── Pure parsing helpers ─────────────────────────────────────────────────────

export const mapRentalObject = (raw: RawRentalObject): KufarRentFlatListing => {
  // kufar travel stores price in BYN minor units (kopeks): 26600 → 266 BYN/night
  const pricePerNightByn =
    typeof raw.price === 'number' && raw.price > 0 ? Math.round(raw.price / 100) : undefined;

  const accommodationType =
    typeof raw.accommodationType === 'number'
      ? (ACCOMMODATION_TYPE_LABELS[raw.accommodationType] ?? String(raw.accommodationType))
      : typeof raw.accommodationType === 'string'
        ? raw.accommodationType
        : undefined;

  // Prefer the high-res gallery list when present; fall back to the single `image` field
  const gallery = raw.images?.gallery ?? raw.images?.listings ?? [];
  const images = gallery.length > 0 ? gallery : raw.image ? [raw.image] : [];

  return {
    adId: raw.adId,
    // selfUrl includes departureDate/arrivalDate for the current search context. We strip the
    // date params so the link works regardless of which day the recipient opens it.
    link: canonicalLink(raw),
    title: raw.subject ?? `Объект ${raw.adId}`,
    pricePerNightByn,
    address: raw.address,
    rooms: raw.rooms,
    area: typeof raw.area === 'number' && raw.area > 0 ? raw.area : undefined,
    personsMax: raw.personsMax,
    accommodationType,
    isHotel: raw.isHotel,
    isSuperhost: raw.isSuperhost,
    rating: typeof raw.rating === 'number' && raw.rating > 0 ? raw.rating : undefined,
    ratingScoresCount: raw.ratingScoresCount,
    listTime: raw.listTime,
    images,
  };
};

/** Build a stable hotel-detail URL from the adId — drops query params from raw selfUrl. */
const canonicalLink = (raw: RawRentalObject): string => {
  if (raw.selfUrl) {
    try {
      const u = new URL(raw.selfUrl);
      return `${u.origin}${u.pathname}`;
    } catch {
      // fall through
    }
  }
  return `https://travel.kufar.by/hotel/${raw.adId}`;
};
