import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
// rebrowser-puppeteer: drop-in Puppeteer replacement that patches the CDP Runtime.Enable
// leak — the main signal Cloudflare uses to detect headless Chrome. Same lib as BidCars.
import puppeteer from 'rebrowser-puppeteer';
import type { Browser, Page } from 'rebrowser-puppeteer';
import { sleep } from '../../common/utils/sleep';
import { fetchEscalating } from '../../common/scraping/escalating-fetch';
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

/** Rung-1 timeout. Short on purpose: a challenge page comes back fast, and this is only
 * a cheap probe before the browser. */
const PLAIN_TIMEOUT_MS = 15_000;

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
    const listings = await fetchEscalating<BamperListing[]>({
      logger: this.logger,
      label: partSlug,
      // Rung 1. bamper.by is behind a Cloudflare JS challenge today, so this normally returns
      // the interstitial and escalates — but it costs ~1s to find out, and the day the site
      // drops the challenge every run becomes free without anyone noticing.
      attemptPlain: () => this.tryPlain(url, partSlug),
      attemptBrowser: () => this.tryBrowser(url, partSlug),
      attemptPaid: async () => {
        const { content, provider } = await this.scraping.scrape(url, {
          country: 'by',
          // `asp` alone clears the challenge and returns the full page. Adding `renderJs`
          // changes nothing and doubles ScrapFly's price: measured on this feed, asp-only cost
          // 40 credits and asp+render cost 80, both yielding the same 7 listings. render alone
          // cost 0 but returned the interstitial.
          asp: true,
          timeoutMs: PROVIDER_TIMEOUT_MS,
        });
        return { value: parseBamperSearchHtml(content, partSlug), provider };
      },
      paidAvailable: this.scraping.isAvailable(),
      retries: CLOUDFLARE_RETRY_ATTEMPTS,
      retryDelayMs: CLOUDFLARE_RETRY_DELAY_MS,
      beforeRetry: async () => {
        await this.browser?.close();
        this.browser = null;
      },
    });

    if (listings === null) throw new Error('Cloudflare challenge not resolved after all retries');
    return listings;
  }

  /**
   * Rung 1 — a plain HTTP request. Returns null when the body is a challenge page rather than
   * the listing page, which is what the parser yielding nothing indicates.
   */
  private async tryPlain(url: string, partSlug: string): Promise<BamperListing[] | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PLAIN_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': BROWSER_USER_AGENT, 'Accept-Language': 'ru-RU,ru;q=0.9' },
      });
      if (!res.ok) return null;
      const listings = parseBamperSearchHtml(await res.text(), partSlug);
      return listings.length > 0 ? listings : null;
    } catch {
      // Any transport failure just means "escalate" — no need to distinguish causes here.
      return null;
    } finally {
      clearTimeout(timer);
    }
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
