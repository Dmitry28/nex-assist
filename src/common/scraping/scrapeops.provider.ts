import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ScrapingQuotaError,
  type ScrapeOptions,
  type ScrapeResult,
  type ScrapingProvider,
} from './scraping.types';

/**
 * ScrapeOps retries the target on its side for up to 2 minutes before answering 500, so the
 * client waits a little longer than that rather than abandon a call that is still in flight.
 */
const DEFAULT_TIMEOUT_MS = 150_000;

/**
 * ScrapeOps Proxy API Aggregator (https://scrapeops.io). Added on 29.09.2026, when bamper.by
 * went dark: ZenRows and Scrape.do were out of credits until their resets and ScrapFly answered
 * 429, while ScrapingAnt is detected by bamper.by outright.
 *
 * Free tier: 1000 credits a month, renewed monthly, one concurrent request. Only 200 and 404
 * answers are billed, so a failed bypass costs nothing — which suits a fallback link. Residential
 * is 10 credits a call, residential with rendering 25.
 *
 * It sits after ScrapingAnt, not before: ScrapingAnt serves bid.cars, whose three rendered calls
 * a run would spend this allowance in about two weeks. Only what ScrapingAnt cannot pass —
 * bamper.by — reaches ScrapeOps.
 */
@Injectable()
export class ScrapeOpsProvider implements ScrapingProvider {
  readonly name = 'scrapeops';
  private readonly logger = new Logger(ScrapeOpsProvider.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  private get apiKey(): string {
    return this.config.get<string>('SCRAPEOPS_API_KEY') ?? process.env.SCRAPEOPS_API_KEY ?? '';
  }

  async scrape(url: string, opts: ScrapeOptions): Promise<ScrapeResult> {
    if (!this.apiKey) throw new Error('SCRAPEOPS_API_KEY is not configured');

    const params = new URLSearchParams({ api_key: this.apiKey, url });
    // Cloudflare on bamper.by lets only residential through, as on ZenRows and Scrape.do. The
    // standard pool's country list has no Belarus; the residential pool covers every country.
    if (opts.asp) params.set('residential', 'true');
    if (opts.country) params.set('country', opts.country.toLowerCase());
    if (opts.renderJs) params.set('render_js', 'true');
    // `wait` turns rendering on by itself.
    if (opts.renderWaitMs) params.set('wait', String(opts.renderWaitMs));

    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const resp = await fetch(`https://proxy.scrapeops.io/v1/?${params.toString()}`, {
        signal: ctrl.signal,
      });

      // 401 is "all credits consumed" and 403 a bad key: nothing more from this provider in this
      // run either way. 429 is only the one-request concurrency limit, and 500 means ScrapeOps
      // gave up on the target after its own retries — both plain failures.
      if (resp.status === 401) {
        throw new ScrapingQuotaError(this.name, 'ScrapeOps credits exhausted (HTTP 401)');
      }
      if (resp.status === 403) {
        throw new ScrapingQuotaError(this.name, 'ScrapeOps rejected the API key (HTTP 403)');
      }
      if (!resp.ok) throw new Error(`ScrapeOps returned HTTP ${resp.status}`);

      const content = await resp.text();
      if (!content.trim()) throw new Error('ScrapeOps returned an empty body');

      this.logger.log(`ScrapeOps OK — ${content.length} bytes for ${url}`);
      return { content, provider: this.name };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`ScrapeOps timeout after ${timeoutMs / 1000}s for ${url}`, { cause: err });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
