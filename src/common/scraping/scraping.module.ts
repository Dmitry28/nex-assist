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
@Module({
  providers: [
    ScrapflyProvider,
    {
      provide: SCRAPING_PROVIDERS,
      useFactory: (scrapfly: ScrapflyProvider): ScrapingProvider[] => [scrapfly],
      inject: [ScrapflyProvider],
    },
    ScrapingClient,
  ],
  exports: [ScrapingClient],
})
export class ScrapingModule {}
