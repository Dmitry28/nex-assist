import { Injectable, Logger } from '@nestjs/common';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import type { CarListing } from './dto/car-listing.dto';
import { PAGE_TIMEOUT_MS } from './constants';

/**
 * Scrapes bid.cars search results using Puppeteer.
 *
 * Uses URL-based card detection (links matching /lot/) instead of CSS class names,
 * which makes it resilient to CSS module renaming.
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

      const listings = await page.evaluate((): CarListing[] => {
        const seen = new Set<string>();
        const results: CarListing[] = [];

        document.querySelectorAll<HTMLAnchorElement>('a[href*="/lot/"]').forEach(anchor => {
          const link = anchor.href;
          if (seen.has(link)) return;
          seen.add(link);

          // Find the card: walk up until the parent contains more than one lot link
          // (that means we've reached the grid/section, so stop one level below)
          let card: Element = anchor;
          for (let i = 0; i < 8; i++) {
            if (!card.parentElement) break;
            if (card.parentElement.querySelectorAll('a[href*="/lot/"]').length > 1) break;
            card = card.parentElement;
          }

          const titleEl =
            card.querySelector('h1, h2, h3') ??
            card.querySelector('[class*="title" i], [class*="name" i]');
          const priceEl = card.querySelector(
            '[class*="price" i], [class*="bid" i], [class*="cost" i]',
          );
          const odometerEl = card.querySelector(
            '[class*="odometer" i], [class*="mileage" i], [class*="miles" i], [class*="km" i]',
          );
          const locationEl = card.querySelector('[class*="location" i], [class*="city" i]');
          const imageEl = card.querySelector<HTMLImageElement>('img');

          results.push({
            link,
            title: titleEl?.textContent?.trim(),
            price: priceEl?.textContent?.trim(),
            odometer: odometerEl?.textContent?.trim(),
            location: locationEl?.textContent?.trim(),
            image: imageEl?.src,
          });
        });

        return results;
      });

      this.logger.log(`Found ${listings.length} listings`);
      return listings;
    } finally {
      await page.close();
    }
  }
}
