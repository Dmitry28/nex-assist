import { Module } from '@nestjs/common';
import { ScraperApiProvider } from './scraper-api.provider';
import { ScrapingAntProvider } from './scrapingant.provider';
import { ScrapflyProvider } from './scrapfly.provider';
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
// counts *credits* (1000/mo) and a measured bamper.by call cost 45-80 of them — six feeds came
// to 250 credits per run, which is 7.5x the monthly free tier if run daily.
//
// ScrapingAnt sits between them: the largest free allowance of the three, but the most
// feature-limited free tier — so it absorbs volume once ScraperAPI is spent, and only what it
// cannot handle reaches ScrapFly.
//
// Ordering cheap-first is safe because the chain falls through: a provider that cannot serve a
// site (weaker bypass, or out of quota) simply hands the request to the next one. ScrapFly is
// deliberately last, so nothing follows it — by then the two volume tiers are exhausted, and
// its credits are the ones worth conserving.
//
// TODO: a fourth fallback once all three free limits are exhausted. Per provider: implement a
// ScrapingProvider adapter, add its API-key env var (validation.schema.ts, .env.example,
// daily-scrape.yml), register it below, and append it after the one it falls back from.
// Candidates: ScrapingBee (free ~1000 credits trial), Scrapingdog (cheap, weaker anti-bot),
// Zyte (strong anti-bot, complex API), Bright Data (paid, last resort).
@Module({
  providers: [
    ScrapflyProvider,
    ScraperApiProvider,
    ScrapingAntProvider,
    {
      provide: SCRAPING_PROVIDERS,
      // Chain order = fallback order.
      useFactory: (
        scraperapi: ScraperApiProvider,
        scrapingant: ScrapingAntProvider,
        scrapfly: ScrapflyProvider,
      ): ScrapingProvider[] => [scraperapi, scrapingant, scrapfly],
      inject: [ScraperApiProvider, ScrapingAntProvider, ScrapflyProvider],
    },
    ScrapingClient,
  ],
  exports: [ScrapingClient],
})
export class ScrapingModule {}
