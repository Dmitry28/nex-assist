import { Injectable, Logger } from '@nestjs/common';
import { fetchEscalating } from '../../common/scraping/escalating-fetch';
import { ScrapingClient } from '../../common/scraping/scraping-client.service';
import { BROWSER_USER_AGENT } from '../../common/utils/scraping';
import type { AvByListing } from './dto/av-by-listing.dto';
import { SCRAPFLY_RENDER_WAIT_MS, SCRAPFLY_TIMEOUT_MS } from './constants';

/** Rung-1 timeout — a cheap probe before paying, so it fails fast. */
const PLAIN_TIMEOUT_MS = 15_000;

/** Shape of the slice of __NEXT_DATA__ we actually read. */
interface RawNextDataAdvert {
  id: number;
  publicUrl: string;
  publishedAt?: string;
  renewedAt?: string;
  year?: number;
  sellerName?: string;
  locationName?: string;
  price?: {
    usd?: { amount?: number };
    byn?: { amount?: number };
  };
  metadata?: {
    vinInfo?: { vin?: string };
  };
  photos?: Array<{ main?: boolean; medium?: { url?: string }; big?: { url?: string } }>;
  properties?: Array<{ name: string; value: string | number }>;
}

interface RawNextData {
  props?: {
    initialState?: {
      filter?: {
        main?: {
          count?: number;
          adverts?: RawNextDataAdvert[];
        };
      };
    };
  };
}

/**
 * Fetches cars.av.by search pages via ScrapFly (residential BY proxy, ASP bypass).
 *
 * av.by SSRs Next.js pages — every filter response embeds the full listing
 * data as JSON in a `<script id="__NEXT_DATA__">` blob. We extract that blob
 * and read `props.initialState.filter.main.adverts` directly, so there is no
 * HTML card parsing.
 *
 * The site is fronted by the SafeLine WAF, which serves a JS challenge before
 * the real page. We therefore request `render_js=true` so ScrapFly executes the
 * challenge; the SSR'd __NEXT_DATA__ is present once it resolves.
 */
@Injectable()
export class AvByParserService {
  private readonly logger = new Logger(AvByParserService.name);

  constructor(private readonly scraping: ScrapingClient) {}

  async fetchFeed(url: string): Promise<{ listings: AvByListing[]; total: number }> {
    const result = await fetchEscalating<{ listings: AvByListing[]; total: number }>({
      logger: this.logger,
      label: 'av.by',
      // Rung 1. Costs ~1s and is normally refused by the SafeLine WAF, but it is the rung that
      // makes this feed free the day av.by stops challenging — and until now this module went
      // straight to a paid provider on every single run.
      attemptPlain: () => this.tryPlain(url),
      // Rung 2 is deliberately absent. A local browser was measured against this WAF and came
      // back with 8 KB and no __NEXT_DATA__, so spending ~9s per feed to prove that again every
      // run would be waste. Recorded here rather than hidden as a branch in the shared policy.
      attemptPaid: async () => {
        const { content, provider } = await this.scraping.scrape(url, {
          country: 'by',
          asp: true,
          renderJs: true,
          renderWaitMs: SCRAPFLY_RENDER_WAIT_MS,
          timeoutMs: SCRAPFLY_TIMEOUT_MS,
        });
        return { value: parseFeed(content), provider };
      },
      paidAvailable: this.scraping.isAvailable(),
      retries: 0,
      retryDelayMs: 0,
    });

    if (result === null) throw new Error('av.by: every fetch rung failed');
    return result;
  }

  /** Rung 1 — plain request. Returns null when the WAF answered instead of the page. */
  private async tryPlain(url: string): Promise<{ listings: AvByListing[]; total: number } | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PLAIN_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': BROWSER_USER_AGENT, 'Accept-Language': 'ru-RU,ru;q=0.9' },
      });
      if (!res.ok) return null;
      const parsed = parseFeed(await res.text());
      return parsed.listings.length > 0 ? parsed : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Turns a page body into the feed shape both rungs return. */
const parseFeed = (html: string): { listings: AvByListing[]; total: number } => {
  const main = extractNextData(html).props?.initialState?.filter?.main;
  const raw = main?.adverts ?? [];
  return { listings: raw.map(mapAdvert), total: main?.count ?? raw.length };
};

const extractNextData = (html: string): RawNextData => {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.+?)<\/script>/s);
  if (!match) {
    // SafeLine WAF challenge page uses `slg-`-prefixed element ids.
    if (html.includes('slg-box')) {
      throw new Error('av.by blocked by SafeLine WAF — challenge not solved');
    }
    throw new Error('__NEXT_DATA__ script not found in av.by response — page structure changed');
  }
  return JSON.parse(match[1]) as RawNextData;
};

const propValue = (props: RawNextDataAdvert['properties'], name: string): string | undefined => {
  const v = props?.find(p => p.name === name)?.value;
  return v === undefined || v === null ? undefined : String(v);
};

const propNumber = (props: RawNextDataAdvert['properties'], name: string): number | undefined => {
  const v = props?.find(p => p.name === name)?.value;
  if (v === undefined || v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const mapAdvert = (a: RawNextDataAdvert): AvByListing => {
  const brand = propValue(a.properties, 'brand');
  const model = propValue(a.properties, 'model');
  const year = propNumber(a.properties, 'year') ?? a.year;
  const titleParts = [brand, model, year ? String(year) : undefined].filter(Boolean);
  const mainPhoto = a.photos?.find(p => p.main) ?? a.photos?.[0];
  return {
    id: a.id,
    url: a.publicUrl,
    title: titleParts.join(' ') || `Объявление ${a.id}`,
    priceUsd: a.price?.usd?.amount ?? 0,
    priceByn: a.price?.byn?.amount ?? 0,
    brand,
    model,
    year,
    mileageKm: propNumber(a.properties, 'mileage_km'),
    engineCapacity: propValue(a.properties, 'engine_capacity'),
    engineType: propValue(a.properties, 'engine_type'),
    transmission: propValue(a.properties, 'transmission_type'),
    bodyType: propValue(a.properties, 'body_type'),
    driveType: propValue(a.properties, 'drive_type'),
    color: propValue(a.properties, 'color'),
    vinPartial: a.metadata?.vinInfo?.vin,
    location: a.locationName,
    sellerName: a.sellerName,
    publishedAt: a.publishedAt,
    renewedAt: a.renewedAt,
    photoUrl: mainPhoto?.medium?.url ?? mainPhoto?.big?.url,
  };
};
