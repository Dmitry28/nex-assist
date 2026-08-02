import { Injectable, Logger } from '@nestjs/common';
import { BROWSER_USER_AGENT } from '../../common/utils/scraping';
import { sleep } from '../../common/utils/sleep';
import {
  FETCH_TIMEOUT_MS,
  INTER_PAGE_DELAY_MS,
  MAX_BUILDINGS_PER_COMPLEX,
  MAX_HTML_SIZE_BYTES,
  PROMETR_ORIGIN,
} from './constants';
import type { TownhouseListing } from './dto/townhouse-listing.dto';

/**
 * Reads the primary (developer) market from prometr.by.
 *
 * Unlike kufar and realt this is plain server-rendered HTML with no `__NEXT_DATA__`, so it is
 * parsed with targeted regexes the way the ghb module handles ghb.by.
 *
 * Two levels: a complex page lists its buildings, and each building page carries the
 * "Квартиры в этом доме" table. The complex page itself has no unit table — the
 * `flats-in__row` strings on it are CSS rules, not markup.
 */
@Injectable()
export class TownhousesPrometrParserService {
  private readonly logger = new Logger(TownhousesPrometrParserService.name);

  /** Fetches every unit on sale in one complex. */
  async fetchComplex(complexUrl: string, complexName: string): Promise<TownhouseListing[]> {
    const complexHtml = await this.fetchHtml(complexUrl);
    if (!complexHtml) return [];

    const buildings = extractBuildingLinks(complexHtml, complexUrl);
    if (buildings.length === 0) {
      this.logger.warn(`${complexName}: no building pages found on ${complexUrl}`);
      return [];
    }

    const listings: TownhouseListing[] = [];
    for (const [i, path] of buildings.slice(0, MAX_BUILDINGS_PER_COMPLEX).entries()) {
      if (i > 0) await sleep(INTER_PAGE_DELAY_MS);
      const html = await this.fetchHtml(`${PROMETR_ORIGIN}${path}`);
      if (!html) continue;
      listings.push(...parseUnits(html, complexName));
    }

    this.logger.log(
      `${complexName}: ${buildings.length} building(s), ${listings.length} unit(s) on sale`,
    );
    return listings;
  }

  private async fetchHtml(url: string): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': BROWSER_USER_AGENT, 'Accept-Language': 'ru-RU,ru;q=0.9' },
      });
      if (!res.ok) {
        this.logger.warn(`HTTP ${res.status} for ${url}`);
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
}

// ─── Pure parsing helpers ─────────────────────────────────────────────────────

/** Collapse whitespace so the regexes below can assume single spaces between tags. */
const normalise = (html: string): string => html.replace(/\s+/g, ' ');

/**
 * Building pages under a complex, e.g. `/newbuild_belarus/grodno/pogorany/dom-2-1_1303/`.
 * The trailing `_<id>` is what distinguishes a building link from navigation.
 */
export const extractBuildingLinks = (html: string, complexUrl: string): string[] => {
  const base = new URL(complexUrl).pathname.replace(/\/$/, '');
  const pattern = new RegExp(`${base}/[a-z0-9-]+_\\d+/`, 'g');
  return [...new Set(normalise(html).match(pattern) ?? [])];
};

/** `"522 937.0 BYN"` → `522937`. Returns undefined when no figure is published. */
export const parseMoney = (raw: string | undefined): number | undefined => {
  if (!raw) return undefined;
  const digits = raw.replace(/[^\d.,]/g, '').replace(/,/g, '.');
  const value = parseFloat(digits);
  return isFinite(value) && value > 0 ? Math.round(value) : undefined;
};

const parseArea = (raw: string | undefined): number | undefined => {
  if (!raw) return undefined;
  const value = parseFloat(raw.replace(',', '.'));
  return isFinite(value) && value > 0 ? value : undefined;
};

/** Extracts the "Квартиры в этом доме" rows from one building page. */
export const parseUnits = (html: string, complexName: string): TownhouseListing[] => {
  const text = normalise(html);
  // Split on the opening tag rather than the bare class name: the page also ships a
  // stylesheet mentioning `flats-in__row`, which would otherwise produce phantom rows.
  const rows = text.split('<div class="flats-in__row">').slice(1);

  const listings: TownhouseListing[] = [];
  for (const row of rows) {
    const cell = (label: string): string | undefined =>
      new RegExp(`${label}</div> <div class="flats-in__value">([^<]*)</div>`).exec(row)?.[1];
    const money = (label: string): string | undefined =>
      new RegExp(`${label}</div>\\s*([\\d\\s.,]+[A-Z]{3})`).exec(row)?.[1];

    const href = /href="(\/newbuild_belarus\/[^"]+)"/.exec(row)?.[1];
    if (!href) continue; // no link → no stable id, skip rather than invent one

    // Unit slugs end in the id after a hyphen — `4-komnatnaya-185-8-38539`. The `_1420`
    // earlier in the path is the building, which several units share.
    const slug = href.replace(/\/$/, '');
    const id = /-(\d+)$/.exec(slug)?.[1] ?? /_(\d+)$/.exec(slug)?.[1] ?? slug;
    const area = parseArea(cell('ПЛОЩАДЬ М2'));
    const rooms = parseArea(cell('Комнат'));

    listings.push({
      uid: `prometr:${id}`,
      source: 'prometr',
      complex: complexName,
      link: `${PROMETR_ORIGIN}${href}`,
      title: [complexName, rooms ? `${rooms}-комн.` : null, area ? `${area} м²` : null]
        .filter(Boolean)
        .join(', '),
      // prometr quotes the primary market in BYN only — there is no USD figure to cross-check.
      priceByn: parseMoney(money('ЦЕНА квартиры')),
      pricePerM2Byn: parseMoney(money('ЦЕНА ЗА М2')),
      area,
      rooms: rooms !== undefined ? Math.round(rooms) : undefined,
      images: [],
    });
  }
  return listings;
};
