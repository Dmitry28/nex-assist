import { Injectable, Logger } from '@nestjs/common';
import { EscalatingHtmlFetcher } from '../../common/scraping/escalating-html-fetcher';
import { FETCH_TIMEOUT_MS, MAX_HTML_BYTES, PROXY_COUNTRY, RENDER_WAIT_MS } from './constants';
import type { IdriverListing } from './dto/idriver-listing.dto';

const BASE_URL = 'https://idriver.by';

/**
 * Scrapes one idriver.by model catalogue page.
 *
 * Two obstacles, both handled on the paid rung of the shared ladder:
 *   • the site answers HTTP 403 to every non-Belarusian IP, so the request needs a `by` proxy —
 *     which also means the plain and local-browser rungs can never succeed from CI or from a
 *     developer machine outside Belarus; they are still attempted because the ladder is shared
 *     and costs nothing to try.
 *   • the first response is a 713-byte stub that calls `/inc/verification.php` and reloads
 *     itself, so the page only exists after JS runs — hence `renderJs`.
 *
 * Rendering is billed on top of the anti-bot tier (~25 ZenRows credits against 10 for a
 * bamper.by page), which is why the module fetches one page per car rather than one per part.
 */
@Injectable()
export class IdriverParserService {
  private readonly logger = new Logger(IdriverParserService.name);

  constructor(private readonly fetcher: EscalatingHtmlFetcher) {}

  async fetch(url: string, label: string): Promise<IdriverListing[]> {
    const html = await this.fetcher.fetch(url, {
      label,
      isUsable: isCataloguePage,
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: MAX_HTML_BYTES,
      country: PROXY_COUNTRY,
      renderJs: true,
      renderWaitMs: RENDER_WAIT_MS,
    });
    if (html === null) {
      throw new Error(`idriver.by page could not be fetched (${PROXY_COUNTRY} proxy, rendered)`);
    }

    const listings = parseIdriverCatalogueHtml(html);
    this.logger.log(`Parsed ${listings.length} listing(s) from ${url}`);
    return listings;
  }
}

// ─── Pure parsing helpers ─────────────────────────────────────────────────────

/**
 * Tells the real catalogue from the verification stub and from an error shell. The stub has no
 * offer cards at all, which is exactly the marker every card carries.
 */
export const isCataloguePage = (html: string): boolean => html.includes('<li class="Element');

const stripTags = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Part name from the card title: everything before the make. Titles read
 * "Бампер задний Volkswagen Atlas Cross Sport, 2020", and sometimes carry the engine
 * ("Лямбда-зонд Volkswagen Atlas 3.6л FSI, 2019"), so the make is the only reliable boundary.
 */
const partFromTitle = (title: string): string => {
  const cut = title.search(/\s+Volkswagen\b/);
  // No make in the title (never seen, but the catalogue is not ours): drop the trailing year
  // rather than return nothing.
  return cut >= 0 ? title.slice(0, cut).trim() : title.replace(/,\s*20\d\d\s*$/, '').trim();
};

/**
 * Parse one idriver.by catalogue page into listings.
 *
 * Every offer is an `<li class="Element<id>">` card carrying schema.org/Offer microdata, so the
 * cards are split on that boundary and read field by field: the detail link (id + url), the
 * `itemprop="name"` title, the `itemprop="price"` meta, the `part_txt` seller note, the
 * "Авто:" spec, and the `dop` row holding city, seller and publication date.
 *
 * The card's photos are deliberately not read: idriver serves every image as WebP (even behind a
 * .jpg path), and Telegram's sendPhoto-by-URL refuses WebP — measured, every send 400'd and fell
 * back to text. The listing link carries the gallery instead. Exported for tests.
 */
export const parseIdriverCatalogueHtml = (html: string): IdriverListing[] => {
  const cards = html.split(/(?=<li class="Element\d+")/).slice(1);
  const byId = new Map<string, IdriverListing>();

  for (const card of cards) {
    const idMatch = card.match(/^<li class="Element(\d+)"/);
    if (!idMatch) continue;
    const id = idMatch[1];
    if (byId.has(id)) continue;

    const linkMatch = card.match(
      new RegExp(`href="(/auto-parts/[a-z0-9-]+/[a-z0-9-]+/[a-z0-9-]+/${id})"`),
    );
    if (!linkMatch) continue;

    const titleMatch = card.match(/itemprop="name">([^<]+)</);
    const title = titleMatch ? stripTags(titleMatch[1]) : '';

    // Donor year — the trailing ", 2021" of the title. Anchored to the end so an engine
    // displacement or an article number in the middle can never be read as a year.
    const yearMatch = title.match(/,\s*(20\d\d)\s*$/);

    // The microdata price is the authoritative number: the visible span is formatted and the
    // card may show a second, converted price next to it.
    const priceMatch = card.match(/itemprop="price" content="([\d.]+)"/);
    const priceByn = priceMatch ? Math.round(Number(priceMatch[1])) : undefined;

    const descMatch = card.match(/class="part_txt"[^>]*>([\s\S]*?)<\/p>/i);
    const description = descMatch ? stripTags(descMatch[1]) || undefined : undefined;

    const specMatch = card.match(/Авто:\s*<strong>([^<]*)<\/strong>/);
    const carSpec = specMatch ? stripTags(specMatch[1]) || undefined : undefined;

    // The "dop" row is three spans in a fixed order: city, seller, date.
    const dopMatch = card.match(/class="dop">([\s\S]*?)<\/li>/);
    const dopSpans = dopMatch
      ? [...dopMatch[1].matchAll(/<span>([\s\S]*?)<\/span>/g)].map(m => stripTags(m[1]))
      : [];
    const publishedAt = dopSpans.find(s => /^\d{2}\.\d{2}\.\d{4}$/.test(s));
    const [city, seller] = dopSpans.filter(s => s !== publishedAt && s.length > 0);

    byId.set(id, {
      id,
      url: `${BASE_URL}${linkMatch[1]}`,
      title: title || `Объявление ${id}`,
      part: partFromTitle(title),
      ...(yearMatch ? { year: Number(yearMatch[1]) } : {}),
      ...(priceByn && priceByn > 0 ? { priceByn } : {}),
      ...(city ? { city } : {}),
      ...(description ? { description } : {}),
      ...(carSpec ? { carSpec } : {}),
      ...(seller ? { seller } : {}),
      ...(publishedAt ? { publishedAt } : {}),
    });
  }

  return [...byId.values()];
};
