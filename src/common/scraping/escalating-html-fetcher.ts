import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import puppeteer, { type Browser } from 'rebrowser-puppeteer';
import { BROWSER_USER_AGENT } from '../utils/scraping';
import { fetchEscalating } from './escalating-fetch';
import { ScrapingClient } from './scraping-client.service';

/** Chrome flags that keep a headless browser from advertising itself. */
const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-blink-features=AutomationControlled',
];

/** Settle time after load so a JS challenge can clear before the DOM is captured (ms). */
const BROWSER_SETTLE_MS = 8_000;

export interface EscalatingHtmlOptions {
  /** Shown in log lines — usually the feed key. */
  label: string;
  /**
   * Whether a body is the page we wanted rather than a challenge or error shell. Without this
   * a Cloudflare interstitial counts as success and the ladder never escalates.
   */
  isUsable: (html: string) => boolean;
  timeoutMs: number;
  maxBytes: number;
  /** Proxy country for the paid rung, when the site is geo-restricted. */
  country?: string;
}

/**
 * Fetches a page over the full escalation ladder: plain request, then a local browser, then the
 * managed provider chain.
 *
 * Every HTML-parsing module used to own a private `fetchHtml` that stopped at the first rung, so
 * a site adding protection meant a silent break — which is exactly how bamper went months
 * without producing data. Sharing the ladder means the free rungs are always attempted and the
 * paid one is always available, without each module implementing it.
 *
 * The browser is launched lazily and reused, so modules whose plain request keeps working never
 * pay for one.
 */
@Injectable()
export class EscalatingHtmlFetcher implements OnModuleDestroy {
  private readonly logger = new Logger(EscalatingHtmlFetcher.name);
  private browser: Browser | null = null;

  constructor(private readonly scraping: ScrapingClient) {}

  async onModuleDestroy(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
  }

  /** Returns the page body, or null when every rung failed. */
  async fetch(url: string, options: EscalatingHtmlOptions): Promise<string | null> {
    return fetchEscalating<string>({
      logger: this.logger,
      label: options.label,
      attemptPlain: () => this.plain(url, options),
      attemptBrowser: () => this.viaBrowser(url, options),
      attemptPaid: async () => {
        const { content, provider } = await this.scraping.scrape(url, {
          ...(options.country ? { country: options.country } : {}),
          asp: true,
          timeoutMs: options.timeoutMs,
        });
        if (!options.isUsable(content)) throw new Error('provider returned an unusable body');
        return { value: content, provider };
      },
      paidAvailable: this.scraping.isAvailable(),
      // A browser that just failed will fail again on the same address; the paid rung is the
      // escape, so there is nothing to gain from repeating rung 2 here.
      retries: 0,
      retryDelayMs: 0,
    });
  }

  /** Rung 1 — plain request. */
  private async plain(url: string, o: EscalatingHtmlOptions): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), o.timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': BROWSER_USER_AGENT, 'Accept-Language': 'ru-RU,ru;q=0.9' },
      });
      if (!res.ok) {
        this.logger.warn(`${o.label}: HTTP ${res.status} for ${url}`);
        return null;
      }
      // Cheap early exit before buffering the body.
      const contentLength = Number(res.headers.get('content-length'));
      if (contentLength > o.maxBytes) {
        this.logger.warn(`${o.label}: Content-Length ${contentLength} exceeds limit — skipping`);
        return null;
      }
      const html = await res.text();
      if (html.length > o.maxBytes) {
        this.logger.warn(`${o.label}: response too large (${html.length} bytes) — skipping`);
        return null;
      }
      return o.isUsable(html) ? html : null;
    } catch (err) {
      this.logger.error(`${o.label}: failed to fetch ${url}`, err);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Rung 2 — local browser, launched on first use and reused afterwards. */
  private async viaBrowser(url: string, o: EscalatingHtmlOptions): Promise<string | null> {
    try {
      const browser = await this.getBrowser();
      const page = await browser.newPage();
      try {
        await page.setUserAgent(BROWSER_USER_AGENT);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: o.timeoutMs });
        await new Promise(resolve => setTimeout(resolve, BROWSER_SETTLE_MS));
        const html = await page.content();
        if (html.length > o.maxBytes) {
          this.logger.warn(`${o.label}: browser body too large (${html.length} bytes)`);
          return null;
        }
        return o.isUsable(html) ? html : null;
      } finally {
        await page.close();
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`${o.label}: browser attempt failed (${reason})`);
      // Recycle: a crashed browser would fail every later call too.
      await this.browser?.close().catch(() => undefined);
      this.browser = null;
      return null;
    }
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browser?.connected) {
      this.logger.log('Launching browser');
      this.browser = await puppeteer.launch({ headless: true, args: BROWSER_ARGS });
    }
    return this.browser;
  }
}
