import { Injectable, Logger } from '@nestjs/common';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import type { Listing, ListingDetails } from './dto/listing.dto';
import { ARCHIVE_MAX_PAGES, ARCHIVE_URL, CONCURRENCY, PAGE_TIMEOUT_MS } from './constants';

const MONTH_MAP: Record<string, string> = {
  января: '01',
  февраля: '02',
  марта: '03',
  апреля: '04',
  мая: '05',
  июня: '06',
  июля: '07',
  августа: '08',
  сентября: '09',
  октября: '10',
  ноября: '11',
  декабря: '12',
};

/**
 * Converts a Russian auction date string like "Аукцион состоится 24 марта 2026 в 12:00"
 * to "24.03.2026" for matching against the archive page date format.
 * Returns undefined if no date is found.
 */
function parseDateFromAuctionDate(auctionDate: string | undefined): string | undefined {
  if (!auctionDate) return undefined;
  const m = auctionDate.match(
    /(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(\d{4})/,
  );
  if (!m) return undefined;
  return `${m[1].padStart(2, '0')}.${MONTH_MAP[m[2]]}.${m[3]}`;
}

/**
 * Strips "руб." and whitespace so "19 370,61 руб." and "19 370,61" both become "19370,61".
 * Used to compare the stored listing price against the archive initial price.
 */
function normalizePrice(price: string): string {
  return price
    .replace(/руб\.?/gi, '')
    .replace(/\s/g, '')
    .trim();
}

/**
 * Scrapes gcn.by land auction listings using Puppeteer.
 * Opens a pool of CONCURRENCY pages to fetch listing details in parallel.
 */
@Injectable()
export class GcnParserService {
  private readonly logger = new Logger(GcnParserService.name);

  async fetchListings(url: string): Promise<Listing[]> {
    const browser: Browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const listings = await this.scrapeListPage(browser, url);
      await this.enrichWithDetails(browser, listings);
      return listings;
    } finally {
      await browser.close();
    }
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
   * Fetch full details for each listing using a pool of concurrent pages.
   * Mutates each listing in place to add price, area, images, etc.
   */
  private async enrichWithDetails(browser: Browser, listings: Listing[]): Promise<void> {
    const poolSize = Math.min(CONCURRENCY, listings.length);
    if (poolSize === 0) return;
    const pages: Page[] = await Promise.all(
      Array.from({ length: poolSize }, () => browser.newPage()),
    );

    // Each page worker pulls from the shared queue. Safe in Node.js because
    // queue.shift() is synchronous — no interleaving can happen between
    // the length check and the shift before the first await.
    const queue = [...listings];

    await Promise.all(
      pages.map(async page => {
        try {
          while (queue.length > 0) {
            const listing = queue.shift();
            if (!listing) break;
            const details = await this.fetchDetails(page, listing.link);
            Object.assign(listing, details);
          }
        } finally {
          await page.close();
        }
      }),
    );
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

    const browser: Browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      // Step 1: scan archive list pages to collect candidate detail URLs
      const candidates: { url: string; date: string }[] = [];
      const listPage: Page = await browser.newPage();
      try {
        for (let pageNum = 1; pageNum <= ARCHIVE_MAX_PAGES; pageNum++) {
          const archiveUrl = pageNum === 1 ? ARCHIVE_URL : `${ARCHIVE_URL}page/${pageNum}/`;
          try {
            await listPage.goto(archiveUrl, {
              waitUntil: 'networkidle2',
              timeout: PAGE_TIMEOUT_MS,
            });
          } catch {
            this.logger.warn(`Archive page ${pageNum} failed to load`);
            break;
          }

          const items = await listPage.evaluate(() =>
            Array.from(document.querySelectorAll('.auction')).map(el => {
              const anchor = el.querySelector<HTMLAnchorElement>('.title a');
              const text = el.textContent ?? '';
              const dateMatch = text.match(/Дата проведения:\s*(\d{2}\.\d{2}\.\d{4})/);
              return {
                title: anchor?.textContent?.trim() ?? '',
                url: anchor?.href ?? '',
                date: dateMatch?.[1] ?? '',
              };
            }),
          );

          for (const item of items) {
            if (!item.url || !item.date) continue;
            if (!targetDates.has(item.date)) continue;
            // Only land-plot ownership auctions (not lease)
            const titleLower = item.title.toLowerCase();
            if (!titleLower.includes('земельного участка')) continue;
            if (titleLower.includes('аренд')) continue;
            candidates.push({ url: item.url, date: item.date });
          }
        }
      } finally {
        await listPage.close();
      }

      if (candidates.length === 0) return result;

      // Step 2: fetch detail pages concurrently and match by initial price
      const queue = [...candidates];
      const poolSize = Math.min(CONCURRENCY, queue.length);
      const detailPages: Page[] = await Promise.all(
        Array.from({ length: poolSize }, () => browser.newPage()),
      );

      await Promise.all(
        detailPages.map(async page => {
          try {
            while (queue.length > 0) {
              const candidate = queue.shift();
              if (!candidate) break;

              try {
                await page.goto(candidate.url, {
                  waitUntil: 'networkidle2',
                  timeout: PAGE_TIMEOUT_MS,
                });
              } catch {
                this.logger.warn(`Archive detail page failed to load: ${candidate.url}`);
                continue;
              }

              const { initialPrice, salePrice } = await page.evaluate(() => {
                const text = document.body.innerText;
                const initMatch = text.match(/Начальная цена:?\s*([\d\s,.]+)\s*руб\./);
                const saleMatch = text.match(/Цена продажи\s*(.+?)(?:\r?\n|$)/);
                return {
                  initialPrice: initMatch?.[1]?.trim() ?? '',
                  salePrice: saleMatch?.[1]?.trim() ?? '',
                };
              });

              if (!initialPrice || !salePrice) continue;

              const normalizedArchive = normalizePrice(initialPrice);
              const dateListings = byDate.get(candidate.date) ?? [];

              for (const listing of dateListings) {
                if (!listing.link || result.has(listing.link)) continue;
                if (!listing.price) continue;
                if (normalizePrice(listing.price) === normalizedArchive) {
                  result.set(listing.link, salePrice);
                }
              }
            }
          } finally {
            await page.close();
          }
        }),
      );
    } catch (error) {
      this.logger.warn('Archive price search failed', error);
    } finally {
      await browser.close();
    }

    this.logger.log(`Archive search complete — found ${result.size} sale prices`);
    return result;
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
