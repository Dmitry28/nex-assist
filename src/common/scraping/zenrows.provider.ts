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
 * ZenRows provider (https://zenrows.com). Sits ahead of ScrapFly because it is the only free
 * tier whose arithmetic covers a daily bamper run.
 *
 * Free tier: 5000 credits/mo, no card. A Cloudflare-protected page costs 25 credits (their
 * "JS Rendering + Premium Proxies (protected)" bracket), i.e. **200 protected requests/mo** —
 * against bamper's six feeds daily, 180/mo. ScrapFly by comparison allows ~25 protected calls
 * a month at the measured 40 credits each, which is why it stays last.
 *
 * NOT YET VERIFIED against a live key. Parameter names come from ZenRows' documentation
 * (`apikey`, `url`, `premium_proxy`, `js_render`, `proxy_country`), but the two providers added
 * before this one both had mapping bugs that only a real request exposed — ScrapingAnt's
 * country case, and error codes misread as quota. Treat the first live run as the real test.
 */
@Injectable()
export class ZenRowsProvider implements ScrapingProvider {
  readonly name = 'zenrows';
  private readonly logger = new Logger(ZenRowsProvider.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  private get apiKey(): string {
    return this.config.get<string>('ZENROWS_API_KEY') ?? process.env.ZENROWS_API_KEY ?? '';
  }

  async scrape(url: string, opts: ScrapeOptions): Promise<ScrapeResult> {
    if (!this.apiKey) throw new Error('ZENROWS_API_KEY is not configured');

    const params = new URLSearchParams({ apikey: this.apiKey, url });
    // `premium_proxy` is the anti-bot tier — residential IPs — which is what clears Cloudflare.
    if (opts.asp) params.set('premium_proxy', 'true');
    if (opts.renderJs) params.set('js_render', 'true');
    // Lower-case ISO-2. ZenRows advertises 190+ countries, so unlike ScrapingAnt there is no
    // short enum to guard against; a rejected code simply fails and the chain moves on.
    if (opts.country) params.set('proxy_country', opts.country.toLowerCase());

    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const resp = await fetch(`https://api.zenrows.com/v1/?${params.toString()}`, {
        signal: ctrl.signal,
      });

      // 402 is the usual "out of credits"; 429 is the documented concurrency/rate limit. Both
      // mean "nothing more from this provider now". Everything else — including a block by the
      // target — is a plain error, so a spent tier stays distinguishable from a failed bypass.
      if (resp.status === 402 || resp.status === 429) {
        throw new ScrapingQuotaError(
          this.name,
          `ZenRows quota/rate limit reached (HTTP ${resp.status})`,
        );
      }
      if (!resp.ok) throw new Error(`ZenRows returned HTTP ${resp.status}`);

      const content = await resp.text();
      if (!content.trim()) throw new Error('ZenRows returned an empty body');

      this.logger.log(`ZenRows OK — ${content.length} bytes for ${url}`);
      return { content, provider: this.name };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`ZenRows timeout after ${timeoutMs / 1000}s for ${url}`, { cause: err });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
