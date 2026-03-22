import { Injectable, Logger } from '@nestjs/common';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import type { CarListing } from './dto/car-listing.dto';
import { CARD_WALK_DEPTH, PAGE_TIMEOUT_MS } from './constants';

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
    const browser: Browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
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
      await page.goto(url, { waitUntil: 'networkidle2', timeout: PAGE_TIMEOUT_MS });

      // Wait for any lot link to appear — signals that results have rendered
      try {
        await page.waitForSelector('a[href*="/lot/"]', { timeout: PAGE_TIMEOUT_MS });
      } catch {
        this.logger.warn(
          'No lot links found — page may not have rendered or search returned 0 results',
        );
        return [];
      }

      const listings = await page.evaluate((walkDepth: number): CarListing[] => {
        const seen = new Set<string>();
        const results: CarListing[] = [];

        /** Parse VIN (17-char) from the end of a lot URL. */
        const vinFromUrl = (href: string): string => {
          const m = href.match(/\/([A-HJ-NPR-Z0-9]{17})(?:[/?#]|$)/i);
          return m ? m[1].toUpperCase() : '';
        };

        /** Parse lot ID from URL path: /lot/<lot-id>/. */
        const lotFromUrl = (href: string): string => {
          const m = href.match(/\/lot\/([^/]+)\//);
          return m ? m[1] : '';
        };

        /**
         * Find a label→value pair within a container element.
         * Works for typical "Label: Value" DOM patterns where a leaf element
         * holds the label text and the next sibling (or parent's sibling) holds
         * the value.
         */
        const labelValue = (container: Element, label: string): string => {
          const lower = label.toLowerCase();
          const els = Array.from(container.querySelectorAll('*')).filter(
            el => el.children.length === 0 && el.textContent?.toLowerCase().includes(lower),
          );
          for (const el of els) {
            const sibling = el.nextElementSibling ?? el.parentElement?.nextElementSibling;
            const val = sibling?.textContent?.trim();
            if (val && val !== el.textContent?.trim()) return val;
          }
          return '';
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

          // Additional fields extracted from the card DOM
          const lv = (label: string) => labelValue(card, label) || undefined;
          const odometer = lv('Odometer') ?? lv('Mileage');
          const damage = lv('Primary Damage') ?? lv('Damage');
          const location = lv('Location') ?? lv('Auction');
          const currentBid = lv('Current Bid') ?? lv('Bid');
          const buyNow = lv('Buy Now') ?? lv('BIN');
          const engine = lv('Engine');
          const keys = lv('Keys');
          const auctionDate = lv('Sale Date') ?? lv('Auction Date');

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
            auctionDate,
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
