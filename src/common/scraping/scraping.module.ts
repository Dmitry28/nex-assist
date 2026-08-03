import { Module } from '@nestjs/common';
import { ScraperApiProvider } from './scraper-api.provider';
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
// Putting the cheap provider first is safe because the chain falls through: if ScraperAPI
// cannot serve a site (it is the weaker bypass), the request simply moves on to ScrapFly.
//
// TODO: further fallbacks once both free limits are exhausted. Per provider: implement a
// ScrapingProvider adapter, add its API-key env var (validation.schema.ts, .env.example,
// daily-scrape.yml), register it below, and append it after the one it falls back from.
// Candidates: ScrapingBee (free ~1000 credits trial), Scrapingdog (cheap, weaker anti-bot),
// Zyte (strong anti-bot, complex API), ScrapingAnt (~10k/mo, feature-limited),
// Bright Data (paid, last resort).
@Module({
  providers: [
    ScrapflyProvider,
    ScraperApiProvider,
    {
      provide: SCRAPING_PROVIDERS,
      // Chain order = fallback order.
      useFactory: (
        scraperapi: ScraperApiProvider,
        scrapfly: ScrapflyProvider,
      ): ScrapingProvider[] => [scraperapi, scrapfly],
      inject: [ScraperApiProvider, ScrapflyProvider],
    },
    ScrapingClient,
  ],
  exports: [ScrapingClient],
})
export class ScrapingModule {}
