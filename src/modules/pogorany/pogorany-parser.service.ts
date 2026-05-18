import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BROWSER_USER_AGENT } from '../../common/utils/scraping';
import { sleep } from '../../common/utils/sleep';
import { FETCH_TIMEOUT_MS, INTER_PRODUCT_DELAY_MS, MAX_HTML_SIZE_BYTES } from './constants';
import type { PogoranyListing } from './dto/pogorany-listing.dto';

/** Shape of one product from the Tilda store list API. */
interface TildaStoreProduct {
  uid: number;
  title: string;
  url: string;
}

/** Shape of the Tilda store list API response. */
interface TildaStoreResponse {
  products?: TildaStoreProduct[];
}

/**
 * Raw edition object embedded in each /tproduct/{uid}-{slug} HTML page.
 * Pricing lives on the edition, not the product, so we always need to fetch the product page.
 *
 * `Cтоимость` — note the leading Latin "C" (not Cyrillic "С") which is how Tilda stores it
 * in this catalog; we accept both spellings defensively.
 */
interface TildaEdition {
  uid: number;
  Cтоимость?: string;
  Стоимость?: string;
  'Стоимость м²'?: string;
  Площадь?: string;
  'Кол-во комнат'?: string;
  'Кол-во санузлов'?: string;
  'Высота потолков'?: string;
  'Площадь участка'?: string;
  'Парковочное место'?: string;
  img?: string;
}

/** Parsed `"103500 USD"` / `"207 000 BYN"` / `"113850USD"` into a number + currency. */
export const parsePriceString = (
  raw: string | undefined,
): { value: number; currency: string } | undefined => {
  if (!raw) return undefined;
  const digits = raw.replace(/[\s\u00A0]+/g, '').match(/^(\d+(?:[.,]\d+)?)/);
  if (!digits) return undefined;
  const value = Number(digits[1].replace(',', '.'));
  if (!isFinite(value) || value <= 0) return undefined;
  const currencyMatch = raw.match(/[A-Za-zА-Яа-я]+\s*$/);
  const currency = currencyMatch ? currencyMatch[0].trim() : '';
  return { value, currency };
};

/**
 * Fetches the pogorany.by catalog by:
 *   1. Calling the Tilda store list API → array of `{uid, title, url}`.
 *   2. Fetching each product page and extracting the `editions` JSON to get price + characteristics.
 *
 * The Tilda store grid on the homepage is rendered client-side, so the list API is the only
 * way to get the full set without a headless browser. Per-product pages are fully server-rendered.
 */
@Injectable()
export class PogoranyParserService {
  private readonly logger = new Logger(PogoranyParserService.name);

  constructor(private readonly config: ConfigService) {}

  async fetch(): Promise<PogoranyListing[]> {
    const apiUrl = this.config.getOrThrow<string>('pogorany.storeApiUrl');

    const products = await this.fetchProductList(apiUrl);
    if (products.length === 0) {
      this.logger.warn('Tilda store API returned no products');
      return [];
    }

    this.logger.log(`Tilda store API: ${products.length} product(s)`);

    const listings: PogoranyListing[] = [];
    for (const [i, product] of products.entries()) {
      if (i > 0) await sleep(INTER_PRODUCT_DELAY_MS);
      const listing = await this.fetchProductPage(product);
      if (listing) listings.push(listing);
    }

    return listings;
  }

  private async fetchProductList(apiUrl: string): Promise<TildaStoreProduct[]> {
    const body = await this.fetchText(apiUrl, 'https://pogorany.by/');
    if (!body) return [];

    let parsed: TildaStoreResponse;
    try {
      parsed = JSON.parse(body) as TildaStoreResponse;
    } catch (err) {
      this.logger.error('Failed to parse Tilda store API JSON', err);
      return [];
    }

    return (parsed.products ?? []).filter(
      (p): p is TildaStoreProduct =>
        typeof p?.uid === 'number' && typeof p?.url === 'string' && typeof p?.title === 'string',
    );
  }

  private async fetchProductPage(product: TildaStoreProduct): Promise<PogoranyListing | null> {
    const html = await this.fetchText(product.url, 'https://pogorany.by/');
    if (!html) {
      this.logger.warn(`No HTML for product ${product.uid} (${product.url})`);
      return null;
    }

    const edition = extractFirstEdition(html);
    if (!edition) {
      this.logger.warn(`No editions JSON found on product ${product.uid} (${product.url})`);
      return {
        uid: product.uid,
        link: product.url,
        title: product.title,
        images: [],
      };
    }

    const priceRaw = edition.Cтоимость ?? edition.Стоимость;
    const price = parsePriceString(priceRaw);
    const pricePerM2 = parsePriceString(edition['Стоимость м²']);

    return {
      uid: product.uid,
      link: product.url,
      title: product.title,
      price: price?.value,
      currency: price?.currency,
      pricePerM2: pricePerM2?.value,
      pricePerM2Currency: pricePerM2?.currency,
      area: edition.Площадь,
      rooms: edition['Кол-во комнат'],
      bathrooms: edition['Кол-во санузлов'],
      ceilingHeight: edition['Высота потолков'],
      plotArea: edition['Площадь участка'],
      parking: edition['Парковочное место'],
      images: edition.img ? [edition.img] : [],
    };
  }

  private async fetchText(url: string, referer: string): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': BROWSER_USER_AGENT,
          'Accept-Language': 'ru-RU,ru;q=0.9',
          Referer: referer,
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

/**
 * Find the first `{"uid":..., ...}` edition JSON object in a /tproduct page.
 * Tilda inlines it as a single non-nested JSON object — a simple regex is enough.
 * Returns undefined if the page does not contain an editions block or fails to parse.
 */
export const extractFirstEdition = (html: string): TildaEdition | undefined => {
  const match = html.match(/\{"uid":\d+,"externalid":"[^"]+"[^}]+\}/);
  if (!match) return undefined;
  try {
    return JSON.parse(match[0]) as TildaEdition;
  } catch {
    return undefined;
  }
};
