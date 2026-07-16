import { Inject, Injectable, Logger } from '@nestjs/common';
import {
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

    let lastError: unknown;
    for (const [i, provider] of configured.entries()) {
      try {
        const result = await provider.scrape(url, opts);
        if (i > 0) this.logger.warn(`Fell back to provider "${provider.name}" for ${url}`);
        return result;
      } catch (err) {
        lastError = err;
        const isQuota = err instanceof ScrapingQuotaError;
        const reason = err instanceof Error ? err.message : String(err);
        const next = configured[i + 1];
        this.logger.warn(
          `Provider "${provider.name}" ${isQuota ? 'out of quota' : 'failed'}: ${reason}` +
            (next ? ` — trying "${next.name}"` : ' — no more providers'),
        );
      }
    }
    throw lastError instanceof Error ? lastError : new Error('All scraping providers failed');
  }
}
