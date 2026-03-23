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
  ad_parameters?: Array<{ p: string; v: unknown }>;
  account_parameters?: Array<{ p: string; v: unknown }>;
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
    // Kufar stores prices as integers in 1/1000 of the currency unit (e.g. 1095000 → 1095 BYN)
    const priceByn = ad.price_byn ? Math.round(parseInt(ad.price_byn, 10) / 1000) : undefined;
    const priceUsd = ad.price_usd ? Math.round(parseInt(ad.price_usd, 10) / 1000) : undefined;

    const getParam = (params: Array<{ p: string; v: unknown }> | undefined, key: string) =>
      params?.find(p => p.p === key)?.v;

    const address = getParam(ad.account_parameters, 'address') as string | undefined;
    // 'size' = m² for garages/apartments; 'size_area' = m² for land plots
    const area =
      (getParam(ad.ad_parameters, 'size') as number | undefined) ??
      (getParam(ad.ad_parameters, 'size_area') as number | undefined);

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
