/**
 * Temporary test script — runs a single bid-cars scrape limited to 3 items.
 * Delete after testing.
 *
 * Usage:
 *   ts-node -r tsconfig-paths/register src/scripts/scrape-bid-cars-test.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { BidCarsParserService } from '../modules/bid-cars/bid-cars-parser.service';
import { BidCarsNotifierService } from '../modules/bid-cars/bid-cars-notifier.service';
import { ConfigService } from '@nestjs/config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const parser = app.get(BidCarsParserService);
    const notifier = app.get(BidCarsNotifierService);
    const config = app.get(ConfigService);

    const url = config.getOrThrow<string>('bidCars.scrapeUrl');
    const allListings = await parser.fetchListings(url);
    const listings = allListings.slice(0, 3);

    console.info(`Scraped ${allListings.length} total, sending ${listings.length} to Telegram`);

    await notifier.notifyRunResult({
      total: allListings.length,
      newListings: listings,
      removedListings: [],
    });
  } finally {
    await app.close();
  }
}

bootstrap().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
