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
 * ScrapFly provider (https://scrapfly.io). Residential proxies + managed browser that
 * solve Cloudflare/SafeLine challenges. Configured via SCRAPFLY_API_KEY.
 */
@Injectable()
export class ScrapflyProvider implements ScrapingProvider {
  readonly name = 'scrapfly';
  private readonly logger = new Logger(ScrapflyProvider.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  private get apiKey(): string {
    return this.config.get<string>('SCRAPFLY_API_KEY') ?? process.env.SCRAPFLY_API_KEY ?? '';
  }

  async scrape(url: string, opts: ScrapeOptions): Promise<ScrapeResult> {
    if (!this.apiKey) throw new Error('SCRAPFLY_API_KEY is not configured');

    const params = new URLSearchParams({ key: this.apiKey, url });
    if (opts.country) params.set('country', opts.country);
    if (opts.asp) params.set('asp', 'true');
    if (opts.renderJs) params.set('render_js', 'true');
    if (opts.renderWaitMs) params.set('rendering_wait', String(opts.renderWaitMs));

    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    let json: {
      result?: { content?: string; status_code?: number };
      context?: { cost?: { total?: number } };
    };
    try {
      const resp = await fetch(`https://api.scrapfly.io/scrape?${params.toString()}`, {
        signal: ctrl.signal,
      });
      // 429 = ScrapFly rate/quota limit — signal the client to try the next provider.
      if (resp.status === 429) {
        throw new ScrapingQuotaError(this.name, 'ScrapFly quota/rate limit reached (HTTP 429)');
      }
      if (!resp.ok) throw new Error(`ScrapFly returned HTTP ${resp.status}`);
      json = (await resp.json()) as typeof json;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`ScrapFly timeout after ${timeoutMs / 1000}s for ${url}`, { cause: err });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const content = json.result?.content;
    if (!content) throw new Error('ScrapFly response missing content');

    const cost = json.context?.cost?.total;
    const statusCode = json.result?.status_code;
    this.logger.log(`ScrapFly OK — upstream ${statusCode}, cost ${cost} credits`);
    return { content, statusCode, cost, provider: this.name };
  }
}
