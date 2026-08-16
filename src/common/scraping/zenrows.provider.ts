import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sleep } from '../utils/sleep';
import {
  ScrapingQuotaError,
  type ScrapeOptions,
  type ScrapeResult,
  type ScrapingProvider,
} from './scraping.types';

/** Default request timeout when the caller doesn't specify one (ms). */
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Statuses worth trying again on the same provider before falling down the chain.
 *
 * 422 is ZenRows' RESP001 "could not get content" — a failed bypass on their side, documented
 * as retryable, and observed as exactly that: the same bamper.by feed 422'd on four runs and
 * returned 690 KB on the next with identical parameters. 429 is the concurrency limit, which
 * clears on its own. Neither SDK retries 422 for us, so it is ours to do.
 */
const RETRY_STATUSES = new Set([422, 429]);

/** Extra attempts after the first, and the pause between them (ms). */
const RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 3_000;

/**
 * ZenRows provider (https://zenrows.com). Sits ahead of ScrapFly because it is the only free
 * tier whose arithmetic covers a daily bamper run.
 *
 * Free tier: 5000 credits/mo, no card. A protected page costs 10 credits on the premium-proxy
 * bracket, or 25 once JS rendering is added — so rendering only when a caller actually needs it
 * is the difference between ~500 and ~200 protected requests a month. ScrapFly by comparison
 * allows ~25 protected calls a month at the measured 40 credits each, which is why it stays last.
 *
 * Verified live against bamper.by: premium_proxy + proxy_country=by returns the real page
 * (684 KB, 8 listings), identical to the same call with js_render. Belarus is supported, unlike
 * ScrapingAnt — which is what makes this the only provider that can reach e-rabota.by at all.
 * js_render alone, without premium_proxy, returns a 6 KB stub.
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

    for (let attempt = 0; ; attempt++) {
      const status = await this.attempt(url, opts);
      if (typeof status !== 'number') return status;
      if (attempt >= RETRY_ATTEMPTS) return this.giveUp(status);
      this.logger.warn(
        `ZenRows returned HTTP ${status} for ${url} — retry ${attempt + 1}/${RETRY_ATTEMPTS} in ${RETRY_DELAY_MS / 1000}s`,
      );
      await sleep(RETRY_DELAY_MS);
    }
  }

  /**
   * One call. Returns the result, or the status code when it is worth retrying — anything
   * else throws, since only the retryable statuses need to survive back up to the loop.
   */
  private async attempt(url: string, opts: ScrapeOptions): Promise<ScrapeResult | number> {
    const params = new URLSearchParams({ apikey: this.apiKey, url });
    // `premium_proxy` is the anti-bot tier — residential IPs — which is what clears Cloudflare
    // and what a geo-blocked site needs. Without it the response is a 6 KB stub.
    if (opts.asp) params.set('premium_proxy', 'true');
    // Rendering is billed separately and is NOT implied by the anti-bot tier. This used to force
    // `js_render` alongside every `asp` call, on a measurement that premium_proxy alone returned
    // 422 — re-measured since and that is wrong: bamper.by returns the same page with the same 8
    // listings either way, and e-rabota.by's API answers 200. Forcing it charged the 25-credit
    // bracket instead of the 10-credit one for every protected call — most of the monthly free
    // tier for nothing. A settle time only means something once rendering happens, so asking to
    // wait implies it.
    if (opts.renderJs || opts.renderWaitMs) params.set('js_render', 'true');
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

      // 402 is "out of credits" — nothing more from this provider now, so the chain moves on
      // immediately. Everything else — including a block by the target — is a plain error, so a
      // spent tier stays distinguishable from a failed bypass.
      if (resp.status === 402) {
        throw new ScrapingQuotaError(this.name, `ZenRows quota reached (HTTP ${resp.status})`);
      }
      if (RETRY_STATUSES.has(resp.status)) return resp.status;
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

  /**
   * A retryable status that outlived its retries. 429 still means the allowance is spent for
   * now — the chain treats that as quota — while a stuck 422 is a failed bypass like any other.
   */
  private giveUp(status: number): never {
    if (status === 429) {
      throw new ScrapingQuotaError(this.name, `ZenRows rate limit reached (HTTP ${status})`);
    }
    throw new Error(`ZenRows returned HTTP ${status} after ${RETRY_ATTEMPTS} retries`);
  }
}
