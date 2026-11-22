import { Injectable, Logger } from '@nestjs/common';
import { EscalatingHtmlFetcher } from '../../common/scraping/escalating-html-fetcher';
import { sleep } from '../../common/utils/sleep';
import { FETCH_TIMEOUT_MS, INTER_REQUEST_DELAY_MS, MAX_HTML_BYTES } from './constants';
import type { RazborfListing } from './dto/razborf-listing.dto';
import { isWantedPart } from './razborf-part-filter';

const BASE_URL = 'https://razborf.by';

/** The site rejects the shared Chrome/120 User-Agent with HTTP 403 but accepts this one. */
const PLAIN_USER_AGENT = 'Mozilla/5.0';

export interface RazborfCategory {
  name: string;
  url: string;
}

export interface RazborfCategoryPage {
  category: RazborfCategory;
  /** Null when the page could not be fetched — distinct from a page with no listings. */
  listings: RazborfListing[] | null;
}

/**
 * Scrapes razborf.by (a single Minsk breaker's yard) in two steps:
 *   1. the model page lists every part category that currently has stock;
 *   2. each wanted category page lists its offers.
 * Categories are discovered rather than hard-coded: a category exists only while it has stock,
 * so a fixed slug list would 404 until the first part arrives and could not be guessed anyway.
 */
@Injectable()
export class RazborfParserService {
  private readonly logger = new Logger(RazborfParserService.name);

  constructor(private readonly fetcher: EscalatingHtmlFetcher) {}

  /** Wanted categories currently in stock. Throws when the model page itself is unavailable. */
  async fetchCategories(modelUrl: string): Promise<RazborfCategory[]> {
    const html = await this.get(modelUrl, 'razborf:model', isModelPage);
    if (html === null) throw new Error('razborf.by model page could not be fetched');
    const all = parseRazborfCategories(html, modelUrl);
    const wanted = all.filter(c => isWantedPart(c.name));
    this.logger.log(`Model page: ${all.length} categories, ${wanted.length} wanted`);
    return wanted;
  }

  async fetchCategoryPages(categories: RazborfCategory[]): Promise<RazborfCategoryPage[]> {
    const pages: RazborfCategoryPage[] = [];
    for (const [i, category] of categories.entries()) {
      if (i > 0) await sleep(INTER_REQUEST_DELAY_MS);
      const html = await this.get(category.url, `razborf:${category.name}`, isCategoryPage);
      pages.push({
        category,
        listings: html === null ? null : parseRazborfListings(html, category.name),
      });
    }
    return pages;
  }

  private get(
    url: string,
    label: string,
    isUsable: (html: string) => boolean,
  ): Promise<string | null> {
    return this.fetcher.fetch(url, {
      label,
      isUsable,
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: MAX_HTML_BYTES,
      userAgent: PLAIN_USER_AGENT,
    });
  }
}

// ─── Pure parsing helpers ─────────────────────────────────────────────────────

export const isModelPage = (html: string): boolean => html.includes('class="cat-list"');
export const isCategoryPage = (html: string): boolean => html.includes('class="prod-list"');

const stripTags = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** Category links of the model page's part index (`ul.cat-list`), deduplicated. */
export const parseRazborfCategories = (html: string, modelUrl: string): RazborfCategory[] => {
  const modelPath = new URL(modelUrl).pathname.replace(/\/$/, '');
  const index = html.match(/<ul class="cat-list">([\s\S]*?)<\/ul>/);
  if (!index) return [];
  const byUrl = new Map<string, RazborfCategory>();
  for (const m of index[1].matchAll(/<a href="([^"]+)">([^<]*)<\/a>/g)) {
    if (!m[1].startsWith(`${modelPath}/`)) continue;
    const name = stripTags(m[2]);
    if (name) byUrl.set(m[1], { name, url: `${BASE_URL}${m[1]}` });
  }
  return [...byUrl.values()];
};

/** Offers of one category page — each is an `<li id="prod<id>">` card. */
export const parseRazborfListings = (html: string, part: string): RazborfListing[] => {
  const cards = html.split(/(?=<li id="prod\d+")/).slice(1);
  const byId = new Map<string, RazborfListing>();

  for (const card of cards) {
    const id = card.match(/^<li id="prod(\d+)"/)?.[1];
    if (!id || byId.has(id)) continue;

    const link = card.match(/<a class='prod-list__item-title-link' href="([^"]+)">([\s\S]*?)<\/a>/);
    if (!link) continue;

    const spec = (label: string): string | undefined => {
      const m = card.match(new RegExp(`<span>${label}:\\s*</span><strong>([^<]*)</strong>`));
      return m ? stripTags(m[1]) || undefined : undefined;
    };
    const year = Number(spec('Год'));
    const engine = spec('Двигатель');
    const gearbox = spec('КПП');
    const carSpec = [engine, gearbox].filter(Boolean).join(', ');

    const price = Number(card.match(/class="BYN price__item"[^>]*>\s*(\d+)/)?.[1]);
    const description = stripTags(
      card.match(/<span>Описание:<\/span>\s*<p>([\s\S]*?)<\/p>/)?.[1] ?? '',
    );
    const photoUrl = card.match(/<img src="(https?:\/\/[^"]+)"/)?.[1];

    byId.set(id, {
      id,
      url: `${BASE_URL}${link[1]}`,
      title: stripTags(link[2]) || `Объявление ${id}`,
      part,
      ...(year >= 1990 ? { year } : {}),
      ...(price > 0 ? { priceByn: price } : {}),
      ...(photoUrl ? { photoUrl } : {}),
      ...(description ? { description } : {}),
      ...(carSpec ? { carSpec } : {}),
    });
  }
  return [...byId.values()];
};
