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
 * Verified live against bamper.by: premium_proxy + js_render + proxy_country=by returns the
 * real page (668 KB, 7 listings). Belarus is supported, unlike ScrapingAnt. The combination
 * matters — premium_proxy alone is a 422, and js_render alone returns a 6 KB stub.
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
    // It has to travel with `js_render`: measured against bamper.by, premium_proxy alone is
    // rejected with 422, and without premium_proxy the response is a 6 KB stub rather than the
    // page. So `asp` implies both here, even when the caller did not ask for rendering — the
    // caller's `renderJs` is about ScrapFly's pricing, where the two are billed separately.
    if (opts.asp) {
      params.set('premium_proxy', 'true');
      params.set('js_render', 'true');
    } else if (opts.renderJs) {
      params.set('js_render', 'true');
    }
    // Lower-case ISO-2. ZenRows advertises 190+ countries, so unlike ScrapingAnt there is no
    // short enum to guard against; a rejected code simply fails and the chain moves on.
    if (opts.country) params.set('proxy_country', opts.country.toLowerCase());
    // Settle time after render. This was missing and it mattered: bid.cars returned 254 KB with
    // zero lot links without it, and 764 KB with 53 links once a 10s wait was passed through.
    // A site that fills its results after load looks like an empty page otherwise.
    if (opts.renderWaitMs) params.set('wait', String(opts.renderWaitMs));

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
