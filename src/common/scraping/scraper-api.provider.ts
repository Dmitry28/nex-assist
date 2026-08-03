import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ScrapingQuotaError,
  type ScrapeOptions,
  type ScrapeResult,
  type ScrapingProvider,
} from './scraping.types';

/** Default request timeout when the caller doesn't specify one (ms). */
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * ScraperAPI provider (https://scraperapi.com). Second link in the chain after ScrapFly.
 *
 * Chosen because its free tier is counted in **requests** (1000/mo) rather than credits, so a
 * feed that needs anti-bot bypass costs the same as a plain page. ScrapFly's free tier is
 * 1000 *credits* and an anti-bot request costs ~25 of them, which av.by already consumes most
 * of — leaving no room for a second Cloudflare-protected site.
 *
 * Unlike ScrapFly this returns the page body directly rather than a JSON envelope, so there
 * is no upstream status or per-call cost to report.
 */
@Injectable()
export class ScraperApiProvider implements ScrapingProvider {
  readonly name = 'scraperapi';
  private readonly logger = new Logger(ScraperApiProvider.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  private get apiKey(): string {
    return this.config.get<string>('SCRAPER_API_KEY') ?? process.env.SCRAPER_API_KEY ?? '';
  }

  async scrape(url: string, opts: ScrapeOptions): Promise<ScrapeResult> {
    if (!this.apiKey) throw new Error('SCRAPER_API_KEY is not configured');

    const params = new URLSearchParams({ api_key: this.apiKey, url });
    // ScraperAPI spells the same concepts differently: `ultra_premium` is its anti-bot tier,
    // `render` its browser rendering, and the country code must be lower-case.
    if (opts.asp) params.set('ultra_premium', 'true');
    if (opts.renderJs) params.set('render', 'true');
    if (opts.country) params.set('country_code', opts.country.toLowerCase());
    // `wait_for_selector` is the documented knob; a plain millisecond wait is not supported,
    // so a requested settle time is expressed as the render timeout instead.
    if (opts.renderWaitMs)
      params.set('render_timeout', String(Math.ceil(opts.renderWaitMs / 1000)));

    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const resp = await fetch(`https://api.scraperapi.com/?${params.toString()}`, {
        signal: ctrl.signal,
      });

      // 429 = rate limited, 403 = plan/credit limit reached. Both mean "this provider is done
      // for now", which is what ScrapingQuotaError signals so the chain moves on.
      if (resp.status === 429 || resp.status === 403) {
        throw new ScrapingQuotaError(
          this.name,
          `ScraperAPI quota/rate limit reached (HTTP ${resp.status})`,
        );
      }
      if (!resp.ok) throw new Error(`ScraperAPI returned HTTP ${resp.status}`);

      const content = await resp.text();
      if (!content.trim()) throw new Error('ScraperAPI returned an empty body');

      this.logger.log(`ScraperAPI OK — ${content.length} bytes for ${url}`);
      return { content, provider: this.name };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`ScraperAPI timeout after ${timeoutMs / 1000}s for ${url}`, { cause: err });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
