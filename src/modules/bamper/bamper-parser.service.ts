import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
// rebrowser-puppeteer: drop-in Puppeteer replacement that patches the CDP Runtime.Enable
// leak — the main signal Cloudflare uses to detect headless Chrome. Same lib as BidCars.
import puppeteer from 'rebrowser-puppeteer';
import type { Browser, Page } from 'rebrowser-puppeteer';
import { sleep } from '../../common/utils/sleep';
import { ScrapingClient } from '../../common/scraping/scraping-client.service';
import { BROWSER_USER_AGENT } from '../../common/utils/scraping';
import {
  CLOUDFLARE_RETRY_ATTEMPTS,
  CLOUDFLARE_RETRY_DELAY_MS,
  CLOUDFLARE_SETTLE_MS,
  PAGE_TIMEOUT_MS,
} from './constants';
import type { BamperListing } from './dto/bamper-listing.dto';

const BASE_URL = 'https://bamper.by';

/** Overall provider request timeout — anti-bot + JS render is slow (ms). */
const PROVIDER_TIMEOUT_MS = 120_000;

const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-blink-features=AutomationControlled',
];

/**
 * Scrapes bamper.by search results using Puppeteer.
 *
 * The whole site is behind a Cloudflare JS challenge (identical to bid.cars), so a
 * plain fetch returns the "Just a moment..." interstitial. We drive a headless
 * browser, wait for the challenge to clear, then parse the fully-rendered HTML with
 * the pure `parseBamperSearchHtml` below (unit-tested against a saved fixture).
 *
 * The browser is reused across calls and closed on module destroy.
 *
 * NOTE: Cloudflare blocks GitHub Actions (AWS) IP ranges, so in CI the local browser never
 * clears the challenge — every scheduled run failed and reported "Cloudflare challenge not
 * resolved after all retries" to Telegram, and the snapshot stayed empty. The managed provider
 * chain exists for that case, but the browser is tried first because it is free: paying only
 * happens once the free attempt has failed.
 */
@Injectable()
export class BamperParserService implements OnModuleDestroy {
  private readonly logger = new Logger(BamperParserService.name);
  private browser: Browser | null = null;

  constructor(private readonly scraping: ScrapingClient) {}

  async onModuleDestroy(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
  }

  /**
   * Fetch one part-search page. `partSlug` is the bamper.by zapchast slug for this
   * part (e.g. "bamper-zadniy") — only listing links with that slug are parsed, so
   * related-part links elsewhere on the page are ignored.
   */
  async fetch(url: string, partSlug: string): Promise<BamperListing[]> {
    // Free first, paid second.
    //
    // The local browser costs nothing and clears the challenge from a residential IP, so it
    // gets the first attempt. Only when it fails do we spend a managed-provider request. The
    // reverse order was the earlier behaviour and it burned 250 ScrapFly credits on a local
    // run where the browser would have succeeded for free.
    //
    // The first browser attempt is deliberately single: in CI the failure is IP reputation
    // (Cloudflare blocks GitHub Actions' AWS ranges), and retrying the same blocked address
    // cannot help — it would only add CLOUDFLARE_RETRY_DELAY_MS per feed before the provider
    // is reached. Retries are kept, but as a last resort after the chain has also failed,
    // since a challenge can genuinely clear on a second try from a good IP.
    const first = await this.tryBrowser(url, partSlug);
    if (first) return first;

    if (this.scraping.isAvailable()) {
      try {
        const { content, provider } = await this.scraping.scrape(url, {
          country: 'by',
          // `asp` alone clears the Cloudflare challenge and returns the full page. Adding
          // `renderJs` changes nothing about the result and doubles ScrapFly's price: measured
          // on this feed, asp-only cost 40 credits and asp+render cost 80, both yielding the
          // same 7 listings. render alone cost 0 but returned the interstitial.
          asp: true,
          timeoutMs: PROVIDER_TIMEOUT_MS,
        });
        const listings = parseBamperSearchHtml(content, partSlug);
        this.logger.log(`Fetched via ${provider}: ${listings.length} listing(s)`);
        return listings;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Scraping chain failed (${reason}) — retrying the local browser`);
      }
    } else {
      this.logger.warn('No scraping provider configured — retrying the local browser');
    }

    for (let attempt = 1; attempt <= CLOUDFLARE_RETRY_ATTEMPTS; attempt++) {
      this.logger.warn(
        `Cloudflare retry ${attempt}/${CLOUDFLARE_RETRY_ATTEMPTS} — waiting ${CLOUDFLARE_RETRY_DELAY_MS / 1000}s`,
      );
      await this.browser?.close();
      this.browser = null;
      await sleep(CLOUDFLARE_RETRY_DELAY_MS);

      const listings = await this.tryBrowser(url, partSlug);
      if (listings) return listings;
    }

    throw new Error('Cloudflare challenge not resolved after all retries');
  }

  /** One browser attempt. Returns null when the challenge did not clear. */
  private async tryBrowser(url: string, partSlug: string): Promise<BamperListing[] | null> {
    const html = await this.fetchHtml(await this.getBrowser(), url);
    return html === null ? null : parseBamperSearchHtml(html, partSlug);
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browser?.connected) {
      this.logger.log('Launching browser');
      this.browser = await puppeteer.launch({ headless: true, args: BROWSER_ARGS });
    }
    return this.browser;
  }

  /** Returns the rendered HTML, or null if a Cloudflare challenge is still up (caller retries). */
  private async fetchHtml(browser: Browser, url: string): Promise<string | null> {
    const page: Page = await browser.newPage();
    await page.setUserAgent(BROWSER_USER_AGENT);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });

      // Give the Cloudflare challenge time to solve and reload into the real page, then
      // check the title: if it is still the interstitial, the challenge failed — return
      // null so the caller relaunches and retries.
      await sleep(CLOUDFLARE_SETTLE_MS);
      const title = await page.title();
      if (title.toLowerCase().includes('just a moment')) {
        this.logger.warn(`Cloudflare challenge not cleared (page title: "${title}")`);
        return null;
      }

      // The real page server-renders the full results list, so its HTML is ready now.
      return await page.content();
    } finally {
      await page.close();
    }
  }
}

// ─── Pure parsing helpers ─────────────────────────────────────────────────────

const stripTags = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

const digits = (s: string): number => Number(s.replace(/\s/g, ''));

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Parse one bamper.by search results page into listings for the given part.
 *
 * Cards live in `div.item-list` and each starts with a `col-sm-4 ... photobox` image
 * column, so we split on that boundary. `partSlug` is the bamper.by zapchast slug for
 * the part (e.g. "bamper-zadniy") — only links with that slug are treated as listings.
 * Per card we read: the listing slug from the detail link (stable id), the
 * `h5.add-title` text (title + donor year), and the price/city from the `price-box`
 * column. Price and photo are best-effort — some offers hide the price. Exported for tests.
 */
export const parseBamperSearchHtml = (html: string, partSlug: string): BamperListing[] => {
  const listStart = html.indexOf('item-list');
  if (listStart === -1) return [];
  const list = html.slice(listStart);

  const linkRe = new RegExp(`href="(/zapchast_${escapeRegExp(partSlug)}/(\\d+-[A-Za-z0-9-]+))/?"`);
  const chunks = list.split(/(?=class="col-sm-4 no-padding photobox")/);
  const byId = new Map<string, BamperListing>();

  for (const chunk of chunks) {
    const linkMatch = chunk.match(linkRe);
    if (!linkMatch) continue;
    const id = linkMatch[2];
    if (byId.has(id)) continue;

    const titleMatch = chunk.match(/<h5[^>]*add-title[^>]*>([\s\S]*?)<\/h5>/i);
    const title = titleMatch ? stripTags(titleMatch[1]) : '';

    const yearMatch = title.match(/(20\d\d)\s*г/);
    const year = yearMatch ? Number(yearMatch[1]) : undefined;

    // Scope price to this card's price-box so a neighbouring card's price never bleeds in.
    const priceMatch = chunk.match(
      /price-box([\s\S]*?)(?=class="col-sm-4 no-padding photobox|list-wrapper|$)/,
    );
    const priceText = priceMatch ? stripTags(priceMatch[1]) : '';
    const usdMatch = priceText.match(/~\s*([\d ]+)\s*\$/);
    const priceUsd = usdMatch ? digits(usdMatch[1]) : undefined;
    // Main BYN price shown as "4 350 00 р." — last two digits are kopecks, dropped.
    const bynMatch = priceText.match(/(\d[\d ]*?)\s+\d{2}\s*р\./);
    const priceByn = bynMatch ? digits(bynMatch[1]) : undefined;

    const cardText = stripTags(chunk);
    const cityMatch = cardText.match(/\d{2}\.\d{2}\s+([А-ЯЁ][А-Яа-яЁё.\- ]+?)\s+\d{1,3}\s*%/);
    const city = cityMatch ? cityMatch[1].trim() : undefined;

    // Seller notes: everything between the title (h5) and the "Артикул:" label — engine,
    // condition, origin, R-line, etc. Falls back to the price-box boundary if no articul.
    const descMatch = chunk.match(/<\/h5>([\s\S]*?)(?:Артикул|<div\s+class="col-sm-2)/i);
    const description = descMatch ? stripTags(descMatch[1]) || undefined : undefined;

    // Seller positive-feedback rating (karma), shown for some sellers only.
    const ratingMatch = chunk.match(/karma[^>]*>\s*(\d{1,3})\s*%/i);
    const sellerRating = ratingMatch ? `${ratingMatch[1]}%` : undefined;

    // The first photo may be an absolute fs.bamper.by URL or a relative /upload/... path,
    // depending on the seller — capture either and normalise to an absolute URL.
    const imgMatch = chunk.match(/<img[^>]+\bsrc="([^"]+?\.(?:jpg|jpeg|png|webp))"/i);
    const rawPhoto = imgMatch ? imgMatch[1] : undefined;
    const photoUrl = rawPhoto?.startsWith('/') ? `${BASE_URL}${rawPhoto}` : rawPhoto;

    byId.set(id, {
      id,
      url: `${BASE_URL}${linkMatch[1]}/`,
      title: title || `Объявление ${id}`,
      year,
      priceByn,
      priceUsd,
      city,
      photoUrl,
      description,
      sellerRating,
    });
  }

  return [...byId.values()];
};
