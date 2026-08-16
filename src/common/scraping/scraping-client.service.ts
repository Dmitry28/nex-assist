import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ScrapingCapabilityError,
  ScrapingQuotaError,
  SCRAPING_PROVIDERS,
  type ScrapeOptions,
  type ScrapeResult,
  type ScrapingProvider,
} from './scraping.types';

/**
 * Tries the configured scraping providers in order and returns the first success.
 * When a provider is out of quota (ScrapingQuotaError) or errors, it falls through
 * to the next — so exhausting ScrapFly's free limit transparently hands off to the
 * next provider in the chain. Add providers by extending the array in ScrapingModule.
 */
@Injectable()
export class ScrapingClient {
  private readonly logger = new Logger(ScrapingClient.name);
  /** Providers whose plan refused an anti-bot request during this process. */
  private readonly refusedAsp = new Set<string>();
  /**
   * Providers that reported a spent allowance during this process. ScrapFly's free tier is
   * 1000 credits granted once at signup — it does not refill monthly — so once it answers 429
   * every later call is a guaranteed wasted round-trip, and the error it leaves behind is the
   * one that surfaces to the caller, hiding the failure that actually mattered.
   */
  private readonly exhausted = new Set<string>();

  constructor(@Inject(SCRAPING_PROVIDERS) private readonly providers: ScrapingProvider[]) {}

  /** True if at least one provider is configured (has its credentials). */
  isAvailable(): boolean {
    return this.providers.some(p => p.isConfigured());
  }

  async scrape(url: string, opts: ScrapeOptions = {}): Promise<ScrapeResult> {
    const configured = this.providers.filter(p => p.isConfigured());
    if (configured.length === 0) {
      throw new Error('No scraping provider is configured');
    }

    // Drop providers that already refused this request class on this plan, or already reported
    // an empty allowance. The memo is only an optimisation, so if it would empty the chain we
    // ignore it and try everyone — better to waste a call than to report "no providers" while
    // some are configured.
    const eligible = configured.filter(
      p => !this.refusedBy(p.name, opts) && !this.exhausted.has(p.name),
    );
    const chain = eligible.length > 0 ? eligible : configured;

    let lastError: unknown;
    // The failure worth reporting is the first provider that genuinely tried and could not do
    // it — not a spent allowance or a plan refusal further down. Reporting the last one taught
    // us this the hard way: three days of bamper.by outages were logged as "ScrapFly out of
    // quota" while the actual cause was a ZenRows 422 two links earlier.
    let realError: unknown;
    for (const [i, provider] of chain.entries()) {
      try {
        const result = await provider.scrape(url, opts);
        if (i > 0) this.logger.warn(`Fell back to provider "${provider.name}" for ${url}`);
        return result;
      } catch (err) {
        lastError = err;
        if (!(err instanceof ScrapingQuotaError) && !(err instanceof ScrapingCapabilityError)) {
          realError ??= err;
        }
        if (err instanceof ScrapingCapabilityError) this.remember(provider.name, opts);
        if (err instanceof ScrapingQuotaError) this.rememberExhausted(provider.name);
        const reason = err instanceof Error ? err.message : String(err);
        const next = chain[i + 1];
        this.logger.warn(
          `Provider "${provider.name}" ${this.describe(err)}: ${reason}` +
            (next ? ` — trying "${next.name}"` : ' — no more providers'),
        );
      }
    }
    const surfaced = realError ?? lastError;
    throw surfaced instanceof Error ? surfaced : new Error('All scraping providers failed');
  }

  private describe(err: unknown): string {
    if (err instanceof ScrapingQuotaError) return 'out of quota';
    if (err instanceof ScrapingCapabilityError) return 'cannot serve this request on its plan';
    return 'failed';
  }

  /**
   * Anti-bot requests are the class that gets refused by plan, and they are the expensive ones to
   * retry, so the memo is kept at that granularity rather than per URL.
   */
  private refusedBy(name: string, opts: ScrapeOptions): boolean {
    return Boolean(opts.asp) && this.refusedAsp.has(name);
  }

  private rememberExhausted(name: string): void {
    if (this.exhausted.has(name)) return;
    this.exhausted.add(name);
    this.logger.warn(`Skipping "${name}" for the rest of this run — its allowance is spent`);
  }

  private remember(name: string, opts: ScrapeOptions): void {
    if (!opts.asp || this.refusedAsp.has(name)) return;
    this.refusedAsp.add(name);
    this.logger.warn(
      `Skipping "${name}" for anti-bot requests for the rest of this run — its plan refuses them`,
    );
  }
}
