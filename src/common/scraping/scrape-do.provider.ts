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

/** Scrape.do reports what each call actually cost — the authoritative number, not our guess. */
const COST_HEADER = 'scrape.do-request-cost';
const REMAINING_HEADER = 'scrape.do-remaining-credits';

/**
 * Scrape.do provider (https://scrape.do). The answer to a chain that had quietly narrowed to one
 * working link: ScrapFly's free credits are a one-time grant and are spent, ScraperAPI's free
 * tier answers 403 to every anti-bot request, and ScrapingAnt is detected outright by the
 * protected sites — leaving ZenRows carrying bamper.by, bid.cars and e-rabota.by alone.
 *
 * Free tier: 1000 credits a month, renewed monthly, no card. Measured live against bamper.by:
 * `super=true` (residential) with `geoCode=by` returns the real page — 754 KB, all 7 listings —
 * and the response header put the cost at 10 credits, so the free tier is ~100 protected calls a
 * month. Without `super` the same URL is a 502: Cloudflare here needs residential, exactly as it
 * does on ZenRows. bid.cars needs rendering on top and cost 25.
 *
 * That arithmetic is why it sits behind ZenRows, whose 5000 credits at the same 10 per protected
 * page are five times the runway, and ahead of ScrapingAnt, which takes ~22s to fail on a
 * protected page — and ahead of ScrapFly, which now fails instantly and forever.
 */
@Injectable()
export class ScrapeDoProvider implements ScrapingProvider {
  readonly name = 'scrapedo';
  private readonly logger = new Logger(ScrapeDoProvider.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  private get apiKey(): string {
    return this.config.get<string>('SCRAPE_DO_API_KEY') ?? process.env.SCRAPE_DO_API_KEY ?? '';
  }

  async scrape(url: string, opts: ScrapeOptions): Promise<ScrapeResult> {
    if (!this.apiKey) throw new Error('SCRAPE_DO_API_KEY is not configured');

    const params = new URLSearchParams({ token: this.apiKey, url });
    // `super` is the residential/mobile tier — the anti-bot bypass, and the only thing that gets
    // past Cloudflare on bamper.by. It is also the 10x credit multiplier, so it is sent only
    // when a caller actually asks for anti-bot treatment.
    if (opts.asp) params.set('super', 'true');
    // Rendering is billed separately (5x on its own, 25x together with residential), so it is
    // never implied by the anti-bot tier — the mistake that once cost ZenRows most of a month.
    if (opts.renderJs || opts.renderWaitMs) params.set('render', 'true');
    // Lower-case ISO-2. Belarus is on the residential list, which is what ScraperAPI's free tier
    // could not do and what makes this provider worth having at all.
    if (opts.country) params.set('geoCode', opts.country.toLowerCase());
    // Settle time after render, in ms — same contract as the other providers' wait.
    if (opts.renderWaitMs) params.set('customWait', String(opts.renderWaitMs));

    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const resp = await fetch(`https://api.scrape.do/?${params.toString()}`, {
        signal: ctrl.signal,
      });

      // 401 is a bad token and 429 is the monthly allowance — both mean "nothing more from this
      // provider now". Everything else, including a 502 when the target refuses the proxy tier
      // we asked for, is a plain failure, so a spent tier stays distinguishable from a bad
      // bypass. That distinction is what the chain reads to decide whether to stop asking.
      if (resp.status === 429) {
        throw new ScrapingQuotaError(this.name, 'Scrape.do monthly credits exhausted (HTTP 429)');
      }
      if (resp.status === 401) {
        throw new ScrapingQuotaError(this.name, 'Scrape.do rejected the token (HTTP 401)');
      }
      if (!resp.ok) throw new Error(`Scrape.do returned HTTP ${resp.status}`);

      const content = await resp.text();
      if (!content.trim()) throw new Error('Scrape.do returned an empty body');

      // Scrape.do turns `super`/`render` on by itself for domains that need them, so the header
      // is the only honest account of what a call cost — and of how much of the month is left.
      const cost = Number(resp.headers.get(COST_HEADER));
      const remaining = resp.headers.get(REMAINING_HEADER);
      const billed = Number.isFinite(cost) && cost > 0;
      const spend = [billed ? `cost ${cost}` : null, remaining ? `${remaining} left` : null]
        .filter(Boolean)
        .join(', ');
      this.logger.log(
        `Scrape.do OK — ${content.length} bytes for ${url}${spend ? ` (${spend})` : ''}`,
      );

      return { content, provider: this.name, ...(billed ? { cost } : {}) };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Scrape.do timeout after ${timeoutMs / 1000}s for ${url}`, { cause: err });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
