import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
// rebrowser-puppeteer: drop-in Puppeteer replacement that patches the CDP Runtime.Enable
// leak — the main signal Cloudflare uses to detect headless Chrome. Same lib as BidCars.
import puppeteer from 'rebrowser-puppeteer';
import type { Browser, Page } from 'rebrowser-puppeteer';
import { sleep } from '../../common/utils/sleep';
import { BROWSER_USER_AGENT } from '../../common/utils/scraping';
import {
  CLOUDFLARE_RETRY_ATTEMPTS,
  CLOUDFLARE_RETRY_DELAY_MS,
  CLOUDFLARE_SETTLE_MS,
  PAGE_TIMEOUT_MS,
} from './constants';
import type { BamperListing } from './dto/bamper-listing.dto';

const BASE_URL = 'https://bamper.by';

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
 * NOTE: Cloudflare blocks GitHub Actions (AWS) IPs intermittently — the same known
 * limitation as BidCars. A blocked run throws after all retries and is reported to
 * Telegram; the next run recovers.
 */
@Injectable()
export class BamperParserService implements OnModuleDestroy {
  private readonly logger = new Logger(BamperParserService.name);
  private browser: Browser | null = null;

  async onModuleDestroy(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
  }

  async fetch(url: string): Promise<BamperListing[]> {
    for (let attempt = 0; attempt <= CLOUDFLARE_RETRY_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        this.logger.warn(
          `Cloudflare retry ${attempt}/${CLOUDFLARE_RETRY_ATTEMPTS} — waiting ${CLOUDFLARE_RETRY_DELAY_MS / 1000}s`,
        );
        await this.browser?.close();
        this.browser = null;
        await sleep(CLOUDFLARE_RETRY_DELAY_MS);
      }

      const html = await this.fetchHtml(await this.getBrowser(), url);
      if (html !== null) return parseBamperSearchHtml(html);
    }

    throw new Error('Cloudflare challenge not resolved after all retries');
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

/**
 * Parse one bamper.by search results page into rear-bumper listings.
 *
 * Cards live in `div.item-list` and each starts with a `col-sm-4 ... photobox` image
 * column, so we split on that boundary. Per card we read: the listing slug from the
 * detail link (stable id), the `h5.add-title` text (title + donor year), and the
 * price/city from the `price-box` column. Price and photo are best-effort — some
 * offers hide the price or lazy-load the image. Exported for unit tests.
 */
export const parseBamperSearchHtml = (html: string): BamperListing[] => {
  const listStart = html.indexOf('item-list');
  if (listStart === -1) return [];
  const list = html.slice(listStart);

  const chunks = list.split(/(?=class="col-sm-4 no-padding photobox")/);
  const byId = new Map<string, BamperListing>();

  for (const chunk of chunks) {
    const linkMatch = chunk.match(/href="(\/zapchast_bamper-zadniy\/(\d+-[A-Za-z0-9-]+))\/?"/);
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
