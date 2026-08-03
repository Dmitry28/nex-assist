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
 * ScrapingAnt provider (https://scrapingant.com). Third link in the chain.
 *
 * Sits between ScraperAPI and ScrapFly because its free allowance is the largest of the three,
 * while its free tier is the most feature-limited — so it absorbs volume once ScraperAPI's
 * 1000 requests/mo are gone, and only what it cannot handle reaches ScrapFly, whose credits
 * are the expensive ones (a measured bamper.by call cost 45-80 of 1000/mo).
 *
 * The key goes in an `x-api-key` header rather than the query string, and the response body is
 * the page itself, so there is no upstream status or per-call cost to report.
 */
@Injectable()
export class ScrapingAntProvider implements ScrapingProvider {
  readonly name = 'scrapingant';
  private readonly logger = new Logger(ScrapingAntProvider.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  private get apiKey(): string {
    return this.config.get<string>('SCRAPINGANT_API_KEY') ?? process.env.SCRAPINGANT_API_KEY ?? '';
  }

  async scrape(url: string, opts: ScrapeOptions): Promise<ScrapeResult> {
    if (!this.apiKey) throw new Error('SCRAPINGANT_API_KEY is not configured');

    const params = new URLSearchParams({ url });
    // `browser` is ScrapingAnt's JS rendering. It has no separate anti-bot switch: the bypass
    // comes from routing through a residential proxy, so `asp` maps onto that instead.
    if (opts.renderJs) params.set('browser', 'true');
    if (opts.asp) params.set('proxy_type', 'residential');
    if (opts.country) params.set('proxy_country', opts.country.toUpperCase());

    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const resp = await fetch(`https://api.scrapingant.com/v2/general?${params.toString()}`, {
        signal: ctrl.signal,
        headers: { 'x-api-key': this.apiKey },
      });

      // 423 is ScrapingAnt's "out of credits"; 429 rate limit, 403 plan rejected. All three mean
      // "done for now", which ScrapingQuotaError signals so the chain moves to the next link.
      if (resp.status === 423 || resp.status === 429 || resp.status === 403) {
        throw new ScrapingQuotaError(
          this.name,
          `ScrapingAnt quota/rate limit reached (HTTP ${resp.status})`,
        );
      }
      if (!resp.ok) throw new Error(`ScrapingAnt returned HTTP ${resp.status}`);

      const content = await resp.text();
      if (!content.trim()) throw new Error('ScrapingAnt returned an empty body');

      this.logger.log(`ScrapingAnt OK — ${content.length} bytes for ${url}`);
      return { content, provider: this.name };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`ScrapingAnt timeout after ${timeoutMs / 1000}s for ${url}`, {
          cause: err,
        });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
