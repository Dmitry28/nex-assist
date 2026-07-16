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
// TODO: add fallback providers to the chain so scraping continues once ScrapFly's
// free limit (1000/mo) is exhausted. Per provider: implement a ScrapingProvider adapter
// (e.g. ScraperApiProvider — free 1000/mo — / Zyte / Scrapingdog), add its API-key env var
// (validation.schema.ts, .env.example, daily-scrape.yml), register it below, and append it
// to the array after ScrapFly. Needs the provider account/key (owner: user).
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
