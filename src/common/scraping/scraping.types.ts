/**
 * Provider-agnostic scraping layer.
 *
 * A `ScrapingProvider` wraps one managed-scraping service (ScrapFly today; ScraperAPI /
 * Zyte / … can be added later). `ScrapingClient` tries the configured providers in order
 * and falls through to the next when one is out of quota or errors — so when ScrapFly's
 * free limit is exhausted the next provider takes over automatically.
 */

/** Per-request scraping options, mapped to each provider's own params. */
export interface ScrapeOptions {
  /** Proxy country (ISO-2), e.g. "by". */
  country?: string;
  /** Enable anti-scraping-protection / anti-bot bypass. */
  asp?: boolean;
  /** Render the page in a real browser (needed for JS challenges). */
  renderJs?: boolean;
  /** Extra wait after load for the challenge/JS to settle (ms). */
  renderWaitMs?: number;
  /** Overall request timeout (ms). */
  timeoutMs?: number;
}

/** Result of a successful scrape. */
export interface ScrapeResult {
  /** Rendered HTML / response body. */
  content: string;
  /** Upstream (target site) HTTP status, if the provider reports it. */
  statusCode?: number;
  /** Provider cost for this call, if reported (e.g. ScrapFly credits). */
  cost?: number;
  /** Name of the provider that served the request. */
  provider: string;
}

/**
 * Thrown by a provider when its quota/credit limit is exhausted — signals the
 * `ScrapingClient` to fall through to the next provider rather than give up.
 */
export class ScrapingQuotaError extends Error {
  constructor(
    readonly provider: string,
    message: string,
  ) {
    super(message);
    this.name = 'ScrapingQuotaError';
  }
}

/** One managed-scraping backend. Implement this to add a provider to the chain. */
export interface ScrapingProvider {
  /** Short identifier used in logs, e.g. "scrapfly". */
  readonly name: string;
  /** True when the provider has the credentials it needs (e.g. API key set). */
  isConfigured(): boolean;
  /** Fetch a URL. Throws `ScrapingQuotaError` when out of quota, or a plain Error on other failures. */
  scrape(url: string, opts: ScrapeOptions): Promise<ScrapeResult>;
}

/** DI token for the ordered list of providers the client should try. */
export const SCRAPING_PROVIDERS = Symbol('SCRAPING_PROVIDERS');
