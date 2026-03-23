import { Injectable, Logger } from '@nestjs/common';
import type { KufarListing } from './dto/kufar-listing.dto';
import { FETCH_TIMEOUT_MS, IMAGE_CDN_BASE, LOOKBACK_HOURS, MAX_PAGES } from './constants';

/** Raw ad shape from Kufar's __NEXT_DATA__ JSON. */
interface RawAd {
  ad_id: number;
  ad_link: string;
  subject: string;
  body_short?: string;
  price_byn?: string;
  price_usd?: string;
  list_time: string;
  images?: Array<{ path: string }>;
  ad_parameters?: Array<{ p: string; v: unknown; vl?: unknown }>;
  account_parameters?: Array<{ p: string; v: unknown; vl?: unknown }>;
}

/** Pagination entry from __NEXT_DATA__. */
interface RawPaginationEntry {
  label: string;
  token: string | null;
}

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

  async fetchFeed(url: string): Promise<KufarListing[]> {
    const allListings: KufarListing[] = [];
    let currentUrl = url;

    for (let page = 1; page <= MAX_PAGES; page++) {
      const html = await this.fetchHtml(currentUrl);
      if (!html) break;

      const { ads, pagination } = this.extractPageData(html);

      if (ads.length === 0) {
        this.logger.warn(`Page ${page}: no ads found — stopping pagination`);
        break;
      }

      const recentAds = ads.filter(ad => this.isRecent(ad.list_time));
      allListings.push(...recentAds.map(ad => this.mapListing(ad)));

      this.logger.log(
        `Page ${page}: ${ads.length} ads total, ${recentAds.length} within ${LOOKBACK_HOURS}h window`,
      );

      // Stop paginating if the oldest ad on this page is outside our window
      const oldestAd = ads[ads.length - 1];
      if (!this.isRecent(oldestAd.list_time)) break;

      const nextToken = pagination.find(p => p.label === 'next')?.token;
      if (!nextToken) break;

      currentUrl = this.buildNextPageUrl(url, nextToken);
    }

    this.logger.log(`Fetched ${allListings.length} listings within ${LOOKBACK_HOURS}h window`);
    return allListings;
  }

  private async fetchHtml(url: string): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'ru-RU,ru;q=0.9',
        },
      });
      if (!res.ok) {
        this.logger.warn(`HTTP ${res.status} for ${url}`);
        return null;
      }
      return await res.text();
    } catch (err) {
      this.logger.error(`Failed to fetch ${url}`, err);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private extractPageData(html: string): { ads: RawAd[]; pagination: RawPaginationEntry[] } {
    const match = html.match(
      /<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/,
    );
    if (!match) {
      this.logger.warn('__NEXT_DATA__ not found in page HTML');
      return { ads: [], pagination: [] };
    }

    try {
      const nextData = JSON.parse(match[1]) as Record<string, unknown>;
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

  private mapListing(ad: RawAd): KufarListing {
    // Kufar stores prices as integers in 1/100 of the currency unit (e.g. 10950000 → 109500 BYN)
    const rawByn = ad.price_byn ? parseInt(ad.price_byn, 10) : 0;
    const rawUsd = ad.price_usd ? parseInt(ad.price_usd, 10) : 0;
    const priceByn = rawByn > 0 ? Math.round(rawByn / 100) : undefined;
    const priceUsd = rawUsd > 0 ? Math.round(rawUsd / 100) : undefined;

    const getParamV = (
      params: Array<{ p: string; v: unknown; vl?: unknown }> | undefined,
      key: string,
    ) => params?.find(p => p.p === key)?.v;

    const getParamVl = (
      params: Array<{ p: string; v: unknown; vl?: unknown }> | undefined,
      key: string,
    ) => params?.find(p => p.p === key)?.vl;

    const address = getParamV(ad.account_parameters, 'address') as string | undefined;
    const seller = getParamV(ad.account_parameters, 'name') as string | undefined;

    // 'size' = building area m²; 'size_area' = land/plot area in sotki
    const area = getParamV(ad.ad_parameters, 'size') as number | undefined;
    const plotArea = getParamV(ad.ad_parameters, 'size_area') as number | undefined;

    const rooms = getParamV(ad.ad_parameters, 'rooms') as number | undefined;
    const yearBuilt = getParamV(ad.ad_parameters, 'year_built') as number | undefined;

    // Human-readable property type from vl field
    const propertyType =
      (getParamVl(ad.ad_parameters, 'garage_type') as string | undefined) ??
      (getParamVl(ad.ad_parameters, 'house_type_for_sell') as string | undefined) ??
      (getParamVl(ad.ad_parameters, 'land_type') as string | undefined);

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
      const vl = getParamVl(ad.ad_parameters, key);
      if (vl == null) continue;
      if (Array.isArray(vl)) {
        features.push(...(vl as string[]).filter(Boolean));
      } else if (typeof vl === 'string' && vl) {
        features.push(vl);
      }
    }

    const images = (ad.images ?? []).map(img => `${IMAGE_CDN_BASE}/${img.path}`);

    return {
      adId: ad.ad_id,
      link: `https://re.kufar.by/vi/${ad.ad_id}`,
      title: ad.subject,
      description: ad.body_short || undefined,
      priceByn,
      priceUsd,
      address: address || undefined,
      area: area !== undefined ? Number(area) : undefined,
      plotArea: plotArea !== undefined ? Number(plotArea) : undefined,
      rooms: rooms !== undefined ? Number(rooms) : undefined,
      yearBuilt: yearBuilt !== undefined ? Number(yearBuilt) : undefined,
      seller: seller || undefined,
      propertyType: propertyType || undefined,
      features: features.length > 0 ? features : undefined,
      listTime: ad.list_time,
      images,
    };
  }

  private isRecent(listTime: string): boolean {
    const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);
    return new Date(listTime) >= cutoff;
  }

  /** Append (or replace) the cursor param on the original search URL. */
  private buildNextPageUrl(baseUrl: string, token: string): string {
    const url = new URL(baseUrl);
    url.searchParams.set('cursor', token);
    return url.toString();
  }
}
