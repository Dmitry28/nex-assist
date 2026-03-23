import { Injectable, Logger } from '@nestjs/common';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, Page } from 'puppeteer';
import type { CarListing } from './dto/car-listing.dto';
import { CARD_WALK_DEPTH, MAX_PAGES, PAGE_TIMEOUT_MS } from './constants';

puppeteerExtra.use(StealthPlugin());

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
 * NOTE: If the page structure changes and nothing is found, check:
 *   1. That lot detail URLs still contain '/lot/'
 *   2. That the page fully loads (check PAGE_TIMEOUT_MS)
 */
@Injectable()
export class BidCarsParserService {
  private readonly logger = new Logger(BidCarsParserService.name);

  async fetchListings(url: string): Promise<CarListing[]> {
    const browser: Browser = await puppeteerExtra.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    try {
      return await this.scrapeResultsPage(browser, url);
    } finally {
      await browser.close();
    }
  }

  /** Scrape all available fields from each card on the search results page. */
  private async scrapeResultsPage(browser: Browser, url: string): Promise<CarListing[]> {
    const page: Page = await browser.newPage();

    // Some sites block requests without a realistic user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });

      // Wait for any lot link to appear — signals that results have rendered
      try {
        await page.waitForSelector('a[href*="/lot/"]', { timeout: PAGE_TIMEOUT_MS });
      } catch {
        const title = await page.title();
        this.logger.warn(
          `No lot links found — page title: "${title}". Possible Cloudflare challenge or empty results.`,
        );
        return [];
      }

      // Click "Загрузить больше" until it disappears or MAX_PAGES is reached
      for (let pageNum = 2; pageNum <= MAX_PAGES; pageNum++) {
        const btn = await page.$('div.load-more a[data-next-page]');
        if (!btn) break;

        const prevCount = await page.evaluate(
          () => document.querySelectorAll('a[href*="/lot/"]').length,
        );

        await btn.click();

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

          const odometer = matchText(/Километраж:\n\s*([^\n]+)/);
          const damage = matchText(/Повреждение:\n\s*([^\n]+)/);
          const location = matchText(/Место расположение:\n\s*([^\n]+)/);
          const currentBid = matchText(/Текущая ставка:\n\s*([^\n]+)/);
          const buyNow = matchText(/Купить сейчас:\n\s*([^\n]+)/);
          // Repurpose `keys` for document/title type (e.g. "Salvage (South Carolina)")
          const keys = matchText(/Док\. продажи:\n\s*([^\n]+)/);
          // Running condition (e.g. "На ходу")
          const condition = matchText(/Статус:\n\s*([^\n]+)/);
          // Auction datetime (e.g. "пн 23 мар., 14:30 GMT+1")
          const auctionDate = matchText(/((?:пн|вт|ср|чт|пт|сб|вс)\s+[^\n]+GMT[+-]\d+)/i);
          // Auction house: standalone line — IAAI, Copart, Manheim, etc.
          const auctionSource = cardText.match(
            /\n(IAAI|IAA|Copart|Manheim|ADESA|BacklotCars|ACV)\n/,
          )?.[1];
          // Seller / insurance company (e.g. "State Farm Group Insurance")
          const seller = matchText(/Продавец:\n\s*([^\n]+)/);
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
    } finally {
      await page.close();
    }
  }
}
