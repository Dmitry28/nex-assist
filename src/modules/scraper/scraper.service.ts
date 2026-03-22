import { Injectable, Logger } from '@nestjs/common';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import type { Details, Item } from './dto/item.dto';
import { CONCURRENCY } from './constants';

/** Handles all Puppeteer browser automation: listing scrape + detail fetching. */
@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);

  /**
   * Scrape the listing page and fetch full details for each item.
   * Opens CONCURRENCY pages in parallel to speed up detail fetching.
   */
  async scrapeItems(url: string): Promise<Item[]> {
    const browser: Browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const items = await this.scrapeListPage(browser, url);
      await this.enrichWithDetails(browser, items);
      return items;
    } finally {
      await browser.close();
    }
  }

  /** Scrape item titles and links from the listing page. */
  private async scrapeListPage(browser: Browser, url: string): Promise<Item[]> {
    const page: Page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: 'networkidle0' });
      await page.waitForSelector('.vc_grid-item', { timeout: 10000 });

      const items: Item[] = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.vc_grid-item')).map(el => ({
          title: el.querySelector('.vc_gitem-post-data-source-post_title')?.textContent?.trim(),
          link: el.querySelector<HTMLAnchorElement>('.vc-zone-link')?.href,
        }));
      });

      this.logger.log(`Found ${items.length} listings`);
      return items;
    } finally {
      await page.close();
    }
  }

  /**
   * Fetch details for all items using a pool of CONCURRENCY concurrent pages.
   * Mutates each item in place (price, area, address, images, etc.).
   */
  private async enrichWithDetails(browser: Browser, items: Item[]): Promise<void> {
    const pages: Page[] = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => browser.newPage()),
    );

    const queue = [...items];

    await Promise.all(
      pages.map(async page => {
        try {
          while (queue.length > 0) {
            const item = queue.shift()!;
            const details = await this.fetchDetails(page, item.link);
            Object.assign(item, details);
          }
        } finally {
          await page.close();
        }
      }),
    );
  }

  /** Fetch details for a single listing page. Returns empty defaults on failure. */
  private async fetchDetails(page: Page, link: string | undefined): Promise<Details> {
    const empty: Details = {
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
      this.logger.warn('Skipping item with no link');
      return empty;
    }

    try {
      await page.goto(link, { waitUntil: 'networkidle2' });
      await page.waitForSelector('.prop, strong', { timeout: 10000 });

      return await page.evaluate((): Details => {
        const text = document.body.innerText;

        const match = (pattern: RegExp): string => {
          const m = text.match(pattern);
          return m ? m[1].trim() : '';
        };

        const price = match(/Начальная цена:\s*([\d\s,]+)\s*руб\./);
        const area =
          match(/Площадь земельного участка:\s*([\d,.]+)\s*га/) ||
          match(/Площадь:\s*([\d,.]+)\s*га/);
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

        // Collect utility connections from a known text block
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

        // Images from gallery first, then from .prop; exclude small cadastral-map buttons
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
