import { Module } from '@nestjs/common';
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
// TODO: add fallback providers so scraping continues once ScrapFly's free limit
// (1000/mo) is exhausted. Per provider: implement a ScrapingProvider adapter, add its
// API-key env var (validation.schema.ts, .env.example, daily-scrape.yml), register it
// below, and append it to the array after ScrapFly. Needs the account/key (owner: user).
// Candidate services:
//   - ScraperAPI    — free 1000/mo, simple HTTP API, solves JS/anti-bot (recommended)
//   - ScrapingBee   — free ~1000 credits (trial), JS render
//   - Scrapingdog   — cheap, free trial, weaker anti-bot
//   - Zyte          — strong anti-bot, more complex API, limited free tier
//   - ScrapingAnt   — free ~10k/mo (feature-limited)
//   - Bright Data   — paid, most powerful (last resort)
@Module({
  providers: [
    ScrapflyProvider,
    {
      provide: SCRAPING_PROVIDERS,
      // Chain order = fallback order. Append new providers after scrapfly, e.g. [scrapfly, scraperapi].
      useFactory: (scrapfly: ScrapflyProvider): ScrapingProvider[] => [scrapfly],
      inject: [ScrapflyProvider],
    },
    ScrapingClient,
  ],
  exports: [ScrapingClient],
})
export class ScrapingModule {}
