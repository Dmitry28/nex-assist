import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
// rebrowser-puppeteer: drop-in Puppeteer replacement that patches the CDP Runtime.Enable
// leak — the main signal Cloudflare uses to detect headless Chrome automation.
// See: https://github.com/rebrowser/rebrowser-patches
import puppeteer from 'rebrowser-puppeteer';
import type { Browser, Page } from 'rebrowser-puppeteer';
import type { CarListing } from './dto/car-listing.dto';
import { fetchEscalating } from '../../common/scraping/escalating-fetch';
import { ScrapingClient } from '../../common/scraping/scraping-client.service';

/** Settle time asked of a provider so bid.cars finishes filling its result cards (ms). */
const PROVIDER_RENDER_WAIT_MS = 10_000;

/**
 * Provider timeout. Must comfortably exceed the settle time plus the provider's own render:
 * passing the browser's PAGE_TIMEOUT_MS cut ZenRows off at 30s mid-render, and only the next
 * link in the chain saved the fetch.
 */
const PROVIDER_TIMEOUT_MS = 120_000;
import { BROWSER_USER_AGENT } from '../../common/utils/scraping';
import {
  CARD_WALK_DEPTH,
  CLOUDFLARE_RETRY_ATTEMPTS,
  CLOUDFLARE_RETRY_DELAY_MS,
  MAX_PAGES,
  PAGE_TIMEOUT_MS,
} from './constants';

// Option 2 of the old TODO here is done: the managed provider chain is wired in as a fallback
// via fetchFreeFirst. The note also over-stated the problem — Cloudflare does not block the
// GitHub Actions range outright. Measured on the same runners, bid.cars returns 51 listings
// while bamper.by is refused, so strictness is per-site. A VPS or self-hosted runner remains
// the only free way to fix a site that is genuinely blocked.

const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-blink-features=AutomationControlled',
];

/**
 * Scrapes bid.cars search results using Puppeteer.
 *
 * All data is extracted from the search results page — individual lot pages
 * are protected by a Cloudflare JS challenge that does not auto-resolve in
 * headless mode. The search results page passes freely and contains all
 * key fields (VIN, lot, bid, buy now, odometer, damage, location, images).
 *
 * Uses URL-based card detection (links matching /lot/) instead of CSS class names,
 * which makes it resilient to front-end rebuilds.
 *
 * The browser instance is reused across calls within a scrape cycle (active →
 * ended → archived lookups). It is closed when the module is destroyed.
 *
 * NOTE: If the page structure changes and nothing is found, check:
 *   1. That lot detail URLs still contain '/lot/'
 *   2. That the page fully loads (check PAGE_TIMEOUT_MS)
 */
@Injectable()
export class BidCarsParserService implements OnModuleDestroy {
  private readonly logger = new Logger(BidCarsParserService.name);

  constructor(private readonly scraping: ScrapingClient) {}
  private browser: Browser | null = null;

  async onModuleDestroy(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
  }

  async fetchListings(url: string): Promise<CarListing[]> {
    const listings = await fetchEscalating<CarListing[]>({
      logger: this.logger,
      label: 'bid.cars',
      // Rung 1 absent: this parser reads the page through page.evaluate rather than from an
      // HTML string, so a plain request has nothing to hand it. Rung 2 is where it starts.
      attemptBrowser: async () => this.scrapeResultsPage(await this.getBrowser(), url),
      attemptPaid: async () => {
        const listings = await this.viaProvider(url);
        if (listings === null) throw new Error('provider body yielded no listings');
        return { value: listings, provider: 'chain' };
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
   * Pulls the cards out of a rendered page.
   *
   * Kept as a `page.evaluate` block rather than an HTML parser because it leans on `innerText`
   * — bid.cars labels its fields as "Label\nvalue" in rendered text, which markup alone does
   * not give you. That is also why the provider rung below feeds the fetched HTML back into a
   * local page instead of parsing it directly: the extraction is reused verbatim, so a fallback
   * cannot quietly return different fields from the primary path.
   */
  private async extractListings(page: Page): Promise<CarListing[]> {
    const listings: CarListing[] = await page.evaluate((walkDepth: number) => {
      const seen = new Set<string>();
      const results: Array<{
        link: string;
        title?: string;
        vin?: string;
        lot?: string;
        odometer?: string;
        damage?: string;
        location?: string;
        currentBid?: string;
        buyNow?: string;
        engine?: string;
        keys?: string;
        condition?: string;
        auctionDate?: string;
        auctionSource?: string;
        seller?: string;
      }> = [];

      /** Parse VIN (17-char) from a lot URL — VIN follows the last hyphen in the slug. */
      const vinFromUrl = (href: string): string => {
        const m = href.match(/([A-HJ-NPR-Z0-9]{17})(?:[/?#]|$)/i);
        return m ? m[1].toUpperCase() : '';
      };

      /** Parse lot ID from URL path: /lot/<lot-id>/. */
      const lotFromUrl = (href: string): string => {
        const m = href.match(/\/lot\/([^/]+)\//);
        return m ? m[1] : '';
      };

      document.querySelectorAll<HTMLAnchorElement>('a[href*="/lot/"]').forEach(anchor => {
        const link = anchor.href;
        if (seen.has(link)) return;
        seen.add(link);

        // Find the card: walk up until the parent contains more than one lot link
        let card: Element = anchor;
        for (let i = 0; i < walkDepth; i++) {
          if (!card.parentElement) break;
          if (card.parentElement.querySelectorAll('a[href*="/lot/"]').length > 1) break;
          card = card.parentElement;
        }

        // Title: prefer heading; avoid grabbing the entire card text blob.
        // Strip trailing VIN, lot ID, and auction source appended by bid.cars.
        const titleEl =
          card.querySelector('h1, h2, h3, h4') ??
          card.querySelector('[class*="title" i]:not([class*="subtitle" i])');
        const title = titleEl?.textContent
          ?.trim()
          .replace(/\s+[A-HJ-NPR-Z0-9]{17}.*$/i, '') // strip VIN and everything after
          .trim();

        // VIN and lot parsed from the URL — 100% reliable regardless of DOM changes
        const vin = vinFromUrl(link) || undefined;
        const lot = lotFromUrl(link) || undefined;

        // bid.cars labels are in Russian. Extract fields by matching label\nvalue
        // patterns from the card's innerText — more reliable than DOM traversal
        // for this site's markup.
        const cardText = (card as HTMLElement).innerText ?? '';
        const matchText = (re: RegExp): string | undefined => {
          const m = cardText.match(re);
          return m ? m[1].trim() : undefined;
        };

        const odometer = matchText(/Километраж:\s*([^\n]+)/);
        const damage = matchText(/Повреждение:\s*([^\n]+)/);
        const location = matchText(/Место расположение:\s*([^\n]+)/);
        const currentBid = matchText(/Текущая ставка:\s*([^\n]+)/);
        const buyNow = matchText(/Купить сейчас:\s*([^\n]+)/);
        // Repurpose `keys` for document/title type (e.g. "Salvage (South Carolina)")
        const keys = matchText(/Док\. продажи:\s*([^\n]+)/);
        // Running condition (e.g. "На ходу")
        const condition = matchText(/Статус:\s*([^\n]+)/);
        // Auction datetime (e.g. "пн 23 мар., 14:30 GMT+1")
        const auctionDate = matchText(/((?:пн|вт|ср|чт|пт|сб|вс)\s+[^\n]+GMT[+-]\d+)/i);
        // Auction house: standalone line — IAAI, Copart, Manheim, etc.
        // Newline-delimited only on a styled page, and lower-cased in the raw markup, so match
        // on any whitespace boundary and normalise the case.
        const auctionSource = cardText
          .match(/(?:^|\s)(IAAI|IAA|Copart|Manheim|ADESA|BacklotCars|ACV)(?=\s|$)/i)?.[1]
          ?.toUpperCase();
        // Seller / insurance company (e.g. "State Farm Group Insurance")
        const seller = matchText(/Продавец:\s*([^\n]+)/);
        // Engine: "2.0L", "4 cyl.", "269HP" appear on consecutive lines — join them
        const engineParts = [
          matchText(/(\d+[.,]\d+[Ll])\b/),
          matchText(/(\d+\s*cyl\.?)/i),
          matchText(/(\d+\s*HP)/i),
        ].filter((x): x is string => x !== undefined);
        const engine = engineParts.length > 0 ? engineParts.join(' ') : undefined;

        results.push({
          link,
          title,
          vin,
          lot,
          odometer,
          damage,
          location,
          currentBid,
          buyNow,
          engine,
          keys,
          condition,
          auctionDate,
          auctionSource: auctionSource ?? undefined,
          seller,
        });
      });

      return results;
    }, CARD_WALK_DEPTH);

    this.logger.log(`Found ${listings.length} listings on results page`);
    return listings;
  }

  /**
   * Rung 3 — provider chain. bid.cars was refused outright in CI on 04.08 after working the day
   * before, and this module had no fallback because its extraction needs a DOM. The provider
   * bypasses the challenge, and `setContent` gives the extraction the DOM it needs.
   *
   * Only the first page of results: "Загрузить больше" issues its own request to bid.cars, which
   * a static body cannot serve. Partial data beats the total outage this replaces.
   */
  private async viaProvider(url: string): Promise<CarListing[] | null> {
    const { content, provider } = await this.scraping.scrape(url, {
      asp: true,
      // bid.cars fills its result cards after load, so without a settle time the provider
      // returns the shell: measured, 254 KB and zero lot links versus 764 KB and 53 with it.
      renderWaitMs: PROVIDER_RENDER_WAIT_MS,
      timeoutMs: PROVIDER_TIMEOUT_MS,
    });
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(content, { waitUntil: 'domcontentloaded' });
      const listings = await this.extractListings(page);
      this.logger.log(
        `bid.cars: fetched via ${provider} — ${listings.length} listing(s), first page only`,
      );
      return listings.length > 0 ? listings : null;
    } finally {
      await page.close();
    }
  }

  /** Returns the shared browser, launching one if not yet started or if it crashed. */
  private async getBrowser(): Promise<Browser> {
    if (!this.browser?.connected) {
      this.logger.log('Launching browser');
      this.browser = await puppeteer.launch({ headless: true, args: BROWSER_ARGS });
    }
    return this.browser;
  }

  /**
   * Scrape all available fields from each card on the search results page.
   * Returns null if a Cloudflare challenge is detected (caller should retry).
   */
  private async scrapeResultsPage(browser: Browser, url: string): Promise<CarListing[] | null> {
    const page: Page = await browser.newPage();

    // Some sites block requests without a realistic user agent
    await page.setUserAgent(BROWSER_USER_AGENT);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });

      // Wait for any lot link to appear — signals that results have rendered
      try {
        await page.waitForSelector('a[href*="/lot/"]', { timeout: PAGE_TIMEOUT_MS });
      } catch {
        const title = await page.title();
        if (title.toLowerCase().includes('just a moment')) {
          this.logger.warn(`Cloudflare challenge detected (page title: "${title}")`);
          return null;
        }
        this.logger.warn(`No lot links found — page title: "${title}". Possibly empty results.`);
        return [];
      }

      // Click "Загрузить больше" until it disappears or MAX_PAGES is reached
      for (let pageNum = 2; pageNum <= MAX_PAGES; pageNum++) {
        const btn = await page.$('div.load-more a[data-next-page]');
        if (!btn) break;

        const prevCount = await page.evaluate(
          () => document.querySelectorAll('a[href*="/lot/"]').length,
        );

        await btn.evaluate(el => (el as HTMLElement).click());

        try {
          await page.waitForFunction(
            (prev: number) => document.querySelectorAll('a[href*="/lot/"]').length > prev,
            { timeout: PAGE_TIMEOUT_MS },
            prevCount,
          );
          this.logger.log(`Loaded page ${pageNum}`);
        } catch {
          this.logger.warn(`Load more timed out on page ${pageNum}`);
          break;
        }
      }

      // `await` is load-bearing: `return promise` inside a try/finally lets the finally run
      // before the promise settles, so page.close() fired while the evaluate was still in
      // flight and the whole process died with an unhandled "Target closed". Splitting the
      // extraction into its own method is what introduced that; it was inline before.
      return await this.extractListings(page);
    } finally {
      await page.close();
    }
  }
}
