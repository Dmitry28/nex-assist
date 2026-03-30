import { Injectable, Logger } from '@nestjs/common';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import type { Listing, ListingDetails } from './dto/listing.dto';
import { ARCHIVE_MAX_PAGES, ARCHIVE_URL, CONCURRENCY, PAGE_TIMEOUT_MS } from './constants';
import { normalizePrice, parseDateFromAuctionDate } from './gcn-parser.utils';

/**
 * Scrapes gcn.by land auction listings using Puppeteer.
 * Opens a pool of CONCURRENCY pages to fetch listing details in parallel.
 */
@Injectable()
export class GcnParserService {
  private readonly logger = new Logger(GcnParserService.name);

  async fetchListings(url: string): Promise<Listing[]> {
    const browser = await this.launchBrowser();
    try {
      const listings = await this.scrapeListPage(browser, url);
      await this.enrichWithDetails(browser, listings);
      return listings;
    } finally {
      await browser.close();
    }
  }

  /**
   * Search the gcn.by archive for sale prices of the given listings.
   * Matches by auction date and normalized initial price.
   * Returns a Map of listing.link → salePrice string.
   * Returns an empty Map (and logs a warning) if the archive is unreachable.
   */
  async findSalePrices(listings: Listing[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (listings.length === 0) return result;

    // Group listings by their formatted auction date ("ДД.ММ.ГГГГ")
    const byDate = new Map<string, Listing[]>();
    for (const listing of listings) {
      const date = parseDateFromAuctionDate(listing.auctionDate);
      if (!date) continue;
      if (!byDate.has(date)) byDate.set(date, []);
      (byDate.get(date) ?? []).push(listing);
    }
    if (byDate.size === 0) return result;

    const targetDates = new Set(byDate.keys());
    const browser = await this.launchBrowser();

    try {
      const candidates = await this.collectArchiveCandidates(browser, targetDates);
      if (candidates.length === 0) return result;

      await this.runWithPool(browser, candidates, async (page, candidate) => {
        try {
          await page.goto(candidate.url, { waitUntil: 'networkidle2', timeout: PAGE_TIMEOUT_MS });
        } catch {
          this.logger.warn(`Archive detail page failed to load: ${candidate.url}`);
          return;
        }

        const { initialPrice, salePrice } = await page.evaluate(() => {
          const text = document.body.innerText;
          const initMatch = text.match(/начальная цена:?\s*([\d\s,.]+)\s*руб\./i);
          const saleMatch = text.match(/Цена продажи\s*(.+?)(?:\r?\n|$)/);
          return {
            initialPrice: initMatch?.[1]?.trim() ?? '',
            salePrice: saleMatch?.[1]?.trim() ?? '',
          };
        });

        if (!initialPrice || !salePrice) return;

        const normalizedArchive = normalizePrice(initialPrice);
        for (const listing of byDate.get(candidate.date) ?? []) {
          if (!listing.link || result.has(listing.link) || !listing.price) continue;
          if (normalizePrice(listing.price) === normalizedArchive) {
            result.set(listing.link, salePrice);
          }
        }
      });
    } catch (error) {
      this.logger.warn('Archive price search failed', error);
    } finally {
      await browser.close();
    }

    this.logger.log(`Archive search complete — found ${result.size} sale prices`);
    return result;
  }

  /** Launch a Puppeteer browser with the project-standard options. */
  private launchBrowser(): Promise<Browser> {
    return puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  }

  /**
   * Run a work function over items using a pool of CONCURRENCY Puppeteer pages.
   * Each page worker pulls from a shared queue until it is empty.
   *
   * Safe in Node.js: queue.shift() is synchronous — no interleaving can happen
   * between the length check and the shift before the first await.
   */
  private async runWithPool<T>(
    browser: Browser,
    items: T[],
    work: (page: Page, item: T) => Promise<void>,
  ): Promise<void> {
    const poolSize = Math.min(CONCURRENCY, items.length);
    if (poolSize === 0) return;
    const pages = await Promise.all(Array.from({ length: poolSize }, () => browser.newPage()));
    const queue = [...items];
    await Promise.all(
      pages.map(async page => {
        try {
          while (queue.length > 0) {
            const item = queue.shift();
            if (!item) break;
            await work(page, item);
          }
        } finally {
          await page.close();
        }
      }),
    );
  }

  /** Scrape listing titles and links from the main catalog page. */
  private async scrapeListPage(browser: Browser, url: string): Promise<Listing[]> {
    const page: Page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: 'networkidle0', timeout: PAGE_TIMEOUT_MS });
      await page.waitForSelector('.vc_grid-item', { timeout: PAGE_TIMEOUT_MS });

      const rawListings = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.vc_grid-item')).map(el => ({
          title: el.querySelector('.vc_gitem-post-data-source-post_title')?.textContent?.trim(),
          link: el.querySelector<HTMLAnchorElement>('.vc-zone-link')?.href,
        })),
      );

      const listings: Listing[] = rawListings.filter(l => !!l.link);
      this.logger.log(`Found ${listings.length} listings`);
      return listings;
    } finally {
      await page.close();
    }
  }

  /**
   * Fetch full details for each listing using the page pool.
   * Mutates each listing in place to add price, area, images, etc.
   */
  private async enrichWithDetails(browser: Browser, listings: Listing[]): Promise<void> {
    await this.runWithPool(browser, listings, async (page, listing) => {
      const details = await this.fetchDetails(page, listing.link);
      Object.assign(listing, details);
    });
  }

  /**
   * Scan archive list pages and collect detail-page URLs for auctions
   * whose date matches one of the target dates.
   */
  private async collectArchiveCandidates(
    browser: Browser,
    targetDates: Set<string>,
  ): Promise<{ url: string; date: string }[]> {
    const candidates: { url: string; date: string }[] = [];
    const listPage = await browser.newPage();
    try {
      for (let pageNum = 1; pageNum <= ARCHIVE_MAX_PAGES; pageNum++) {
        const archiveUrl = pageNum === 1 ? ARCHIVE_URL : `${ARCHIVE_URL}page/${pageNum}/`;
        try {
          await listPage.goto(archiveUrl, { waitUntil: 'networkidle2', timeout: PAGE_TIMEOUT_MS });
        } catch {
          this.logger.warn(`Archive page ${pageNum} failed to load`);
          break;
        }

        const items = await listPage.evaluate(() =>
          Array.from(document.querySelectorAll('.auction')).map(el => {
            // Second <a> has the title text; first <a> wraps the thumbnail image
            const anchor = Array.from(el.querySelectorAll<HTMLAnchorElement>('a')).find(
              a => !!a.textContent?.trim(),
            );
            const dateText = el.querySelector('.begin_date')?.textContent ?? '';
            const dateMatch = dateText.match(/(\d{2}\.\d{2}\.\d{4})/);
            return {
              title: anchor?.textContent?.trim() ?? '',
              url: anchor?.href ?? '',
              date: dateMatch?.[1] ?? '',
            };
          }),
        );

        for (const item of items) {
          if (!item.url || !item.date || !targetDates.has(item.date)) continue;
          // Only land-plot ownership auctions (not lease)
          const titleLower = item.title.toLowerCase();
          if (!titleLower.includes('земельного участка') || titleLower.includes('аренд')) continue;
          candidates.push({ url: item.url, date: item.date });
        }
      }
    } finally {
      await listPage.close();
    }
    return candidates;
  }

  /** Fetch detail fields from a single listing page. Returns empty defaults on failure. */
  private async fetchDetails(page: Page, link: string | undefined): Promise<ListingDetails> {
    const empty: ListingDetails = {
      price: 'Не найдено',
      area: 'Не найдено',
      address: 'Не найдено',
      cadastralNumber: 'Не найдено',
      cadastralMapUrl: '',
      auctionDate: 'Не указана',
      applicationDeadline: 'Не указан',
      communications: 'Не указаны',
      images: [],
    };

    if (!link) {
      this.logger.warn('Skipping listing with no link');
      return empty;
    }

    try {
      await page.goto(link, { waitUntil: 'networkidle2', timeout: PAGE_TIMEOUT_MS });
      await page.waitForSelector('.prop, strong', { timeout: PAGE_TIMEOUT_MS });

      return await page.evaluate((): ListingDetails => {
        const text = document.body.innerText;

        const match = (pattern: RegExp): string | undefined => {
          const m = text.match(pattern);
          return m ? m[1].trim() : undefined;
        };

        const price = match(/Начальная цена:\s*([\d\s,]+)\s*руб\./);
        const area =
          match(/Площадь земельного участка:\s*([\d,.]+)\s*га/) ||
          match(/Площадь:\s*([\d,.]+)\s*га/);
        // Address can appear as a standalone field or embedded in the description
        const address = match(/Адрес:\s*(.+)/) || match(/по адресу:\s*(г\.[^\n]+)/);
        const cadastralNumber = match(/Кадастровый номер:\s*(\d+)/);

        const cadastralMapEl = document.querySelector<HTMLAnchorElement>(
          '.prop a[href*="map.nca.by"]',
        );
        const cadastralMapUrl = cadastralMapEl?.href ?? '';

        // Auction date — prefer a link with the exact phrase, fall back to <em>
        const auctionLinkEl = Array.from(document.querySelectorAll('.prop a')).find(a =>
          a.textContent?.includes('Аукцион состоится'),
        );
        const auctionEmEl = document.querySelector('.prop em');
        const auctionDate =
          auctionLinkEl?.textContent?.trim() ?? auctionEmEl?.textContent?.trim() ?? 'Не указана';

        const deadlineLinkEl = Array.from(document.querySelectorAll('.prop a')).find(a =>
          a.textContent?.includes('Заявления принимаются'),
        );
        const applicationDeadline = deadlineLinkEl?.textContent?.trim() ?? 'Не указан';

        // Collect available utility connections from a known text block
        const commsSource =
          text.match(/Имеется возможность подключения к сетям\s+(.+?)(?:\n|Победитель)/s)?.[1] ??
          '';
        const commsMap: [RegExp, string][] = [
          [/электроснабжени/i, 'электроснабжение'],
          [/газоснабжени/i, 'газоснабжение'],
          [/водоснабжени/i, 'водоснабжение'],
          [/водоотведени/i, 'водоотведение'],
          [/теплоснабжени/i, 'теплоснабжение'],
        ];
        const foundComms = commsMap.filter(([re]) => re.test(commsSource)).map(([, name]) => name);
        const communications = foundComms.length > 0 ? foundComms.join(', ') : 'Не указаны';

        // Images: prefer gallery, fall back to .prop images; exclude small cadastral-map buttons
        const galleryEls = document.querySelectorAll('#image-gallery img');
        const propEls = document.querySelectorAll('.prop img');
        const allImgEls = galleryEls.length > 0 ? galleryEls : propEls;
        const images = Array.from(allImgEls)
          .filter(
            img =>
              (img as HTMLImageElement).naturalHeight > 100 ||
              (img as HTMLImageElement).height > 100 ||
              !(img as HTMLImageElement).height,
          )
          .map(img => (img as HTMLImageElement).src)
          .filter(src => !!src && !src.includes('knopka'));

        return {
          price: price ? price + ' руб.' : 'Не найдено',
          area: area ? area + ' га' : 'Не найдено',
          address: address || 'Не найден',
          cadastralNumber: cadastralNumber || 'Не найден',
          cadastralMapUrl,
          auctionDate,
          applicationDeadline,
          communications,
          images,
        };
      });
    } catch (error) {
      this.logger.error(`Failed to fetch details for ${link}`, error);
      return empty;
    }
  }
}
