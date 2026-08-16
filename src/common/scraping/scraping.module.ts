import { Module } from '@nestjs/common';
import { ScrapeDoProvider } from './scrape-do.provider';
import { ScraperApiProvider } from './scraper-api.provider';
import { ScrapingAntProvider } from './scrapingant.provider';
import { ZenRowsProvider } from './zenrows.provider';
import { ScrapflyProvider } from './scrapfly.provider';
import { EscalatingHtmlFetcher } from './escalating-html-fetcher';
import { ScrapingClient } from './scraping-client.service';
import { SCRAPING_PROVIDERS, type ScrapingProvider } from './scraping.types';

/**
 * Provides the ScrapingClient with its ordered provider chain.
 *
 * Chain order = fallback order. Today: [ScrapFly]. To add a provider, implement
 * ScrapingProvider, add it to `providers` below, and append it to the injected array
 * (after the one it should fall back from).
 */
// Chain order is fallback order, and it is ordered by cost, not by capability.
//
// ScraperAPI first: its free tier counts *requests* (1000/mo), so a Cloudflare-protected page
// costs the same as a plain one. ScrapFly second: it is the stronger bypass but its free tier
// counts *credits* and a measured bamper.by call cost 45-80 of them — six feeds came to 250
// credits per run. Worse than it looks: those 1000 credits are granted once at signup and do
// not refill monthly, so ScrapFly is a one-off reserve, not a recurring allowance. It has been
// spent since 2026-08-12 and answers 429 to everything; the client now stops calling it after
// the first such answer within a run. Restoring it means paying.
//
// ZenRows comes second: measured against bamper.by, ScraperAPI cannot target Belarus on the
// free tier (403) and ScrapingAnt is detected outright (423), while ZenRows is the only free
// tier whose arithmetic covers a daily run — 5000 credits/mo at 25 per protected page is 200
// requests, against bamper's 180. It is placed ahead of ScrapingAnt because ScrapingAnt takes
// ~22s to fail on a protected page, and ahead of ScrapFly because ScrapFly's measured 40
// credits per call allow only ~25 a month.
//
// Scrape.do comes third, and it exists because the chain had quietly narrowed to one working
// link. Measured live against bamper.by: `super=true` (residential) with `geoCode=by` returns the
// real page and the response header put the cost at 10 credits, so its 1000-a-month free tier —
// renewed monthly, unlike ScrapFly's one-time grant — is ~100 protected calls. Without `super`
// the same URL is a 502, so Cloudflare needs residential here just as it does on ZenRows. That
// puts it behind ZenRows, whose 5000 credits at the same 10 per page are five times the runway,
// and ahead of ScrapingAnt, which takes ~22s to fail on anything protected.
//
// ScrapingAnt still earns its slot for unprotected sites, where it is the largest allowance.
//
// Ordering cheap-first is safe because the chain falls through: a provider that cannot serve a
// site (weaker bypass, or out of quota) simply hands the request to the next one. ScrapFly is
// deliberately last, so nothing follows it — by then the two volume tiers are exhausted, and
// its credits are the ones worth conserving.
//
// TODO: a fifth fallback once all four free limits are exhausted. Scrape.do is the next
// candidate: 1000 successful calls/mo free, no card, and it does not charge for blocks or
// timeouts — which suits a fallback chain. Its protected-domain credit multiplier is not
// documented publicly, so the free allowance may be smaller in practice than it looks. Per provider: implement a
// ScrapingProvider adapter, add its API-key env var (validation.schema.ts, .env.example,
// daily-scrape.yml), register it below, and append it after the one it falls back from.
// Candidates: ScrapingBee (free ~1000 credits trial), Scrapingdog (cheap, weaker anti-bot),
// Zyte (strong anti-bot, complex API), Bright Data (paid, last resort).
@Module({
  providers: [
    ScrapflyProvider,
    ScraperApiProvider,
    ZenRowsProvider,
    ScrapeDoProvider,
    ScrapingAntProvider,
    {
      provide: SCRAPING_PROVIDERS,
      // Chain order = fallback order.
      useFactory: (
        scraperapi: ScraperApiProvider,
        zenrows: ZenRowsProvider,
        scrapedo: ScrapeDoProvider,
        scrapingant: ScrapingAntProvider,
        scrapfly: ScrapflyProvider,
      ): ScrapingProvider[] => [scraperapi, zenrows, scrapedo, scrapingant, scrapfly],
      inject: [
        ScraperApiProvider,
        ZenRowsProvider,
        ScrapeDoProvider,
        ScrapingAntProvider,
        ScrapflyProvider,
      ],
    },
    ScrapingClient,
    EscalatingHtmlFetcher,
  ],
  exports: [ScrapingClient, EscalatingHtmlFetcher],
})
export class ScrapingModule {}
