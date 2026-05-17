import { Injectable, Logger } from '@nestjs/common';
import type { AvByListing } from './dto/av-by-listing.dto';
import { SCRAPFLY_TIMEOUT_MS } from './constants';

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
 * HTML card parsing and no need to render JS (saves ScrapFly credits).
 *
 * Cost per call: 25 ScrapFly credits (residential proxy, country=by, asp=true).
 */
@Injectable()
export class AvByParserService {
  private readonly logger = new Logger(AvByParserService.name);

  constructor(private readonly apiKey: string) {}

  async fetchFeed(url: string): Promise<{ listings: AvByListing[]; total: number }> {
    if (!this.apiKey) {
      throw new Error('SCRAPFLY_API_KEY is not configured');
    }

    const params = new URLSearchParams({
      key: this.apiKey,
      url,
      country: 'by',
      asp: 'true',
    });

    const apiUrl = `https://api.scrapfly.io/scrape?${params.toString()}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SCRAPFLY_TIMEOUT_MS);

    let json: {
      result?: { content?: string; status_code?: number };
      context?: { cost?: { total?: number } };
    };
    try {
      const resp = await fetch(apiUrl, { signal: ctrl.signal });
      if (!resp.ok) {
        throw new Error(`ScrapFly returned HTTP ${resp.status}`);
      }
      json = (await resp.json()) as typeof json;
    } finally {
      clearTimeout(timer);
    }

    const cost = json.context?.cost?.total;
    const upstreamStatus = json.result?.status_code;
    this.logger.log(`ScrapFly OK — upstream ${upstreamStatus}, cost ${cost} credits`);

    const html = json.result?.content;
    if (!html) {
      throw new Error('ScrapFly response missing content');
    }

    const nextData = extractNextData(html);
    const main = nextData.props?.initialState?.filter?.main;
    const raw = main?.adverts ?? [];
    const total = main?.count ?? raw.length;

    return { listings: raw.map(mapAdvert), total };
  }
}

const extractNextData = (html: string): RawNextData => {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.+?)<\/script>/s);
  if (!match) {
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
