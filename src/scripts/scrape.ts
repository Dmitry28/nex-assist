/**
 * One-shot scrape script for CI / GitHub Actions.
 *
 * Bootstraps the NestJS application context (no HTTP server), runs scrape
 * cycles, then exits.
 *
 * Usage:
 *   npm run scrape              # run all modules
 *   npm run scrape:land         # land-auctions only
 *   npm run scrape:bid-cars     # bid-cars only
 *   npm run scrape:kufar        # kufar only
 *
 * TODO: replace with a proper persistent deployment — see _TODO.md in the
 * land-auctions module.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { BidCarsService } from '../modules/bid-cars/bid-cars.service';
import { KufarService } from '../modules/kufar/kufar.service';
import { LandAuctionsService } from '../modules/land-auctions/land-auctions.service';

type Module = 'land' | 'bid-cars' | 'kufar' | 'all';

function parseModule(): Module {
  const arg = process.argv[2];
  if (!arg || arg === 'all') return 'all';
  if (arg === 'land' || arg === 'bid-cars' || arg === 'kufar') return arg;
  console.error(`Unknown module: "${arg}". Valid options: land, bid-cars, kufar`);
  process.exit(1);
}

async function bootstrap(): Promise<void> {
  const target = parseModule();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    // Run sequentially to avoid two Puppeteer instances competing for memory.
    // Each scraper is wrapped independently so one failure does not skip the other.
    // Errors are already reported to Telegram via notifyError() inside each service.
    if (target === 'all' || target === 'land') {
      try {
        await app.get(LandAuctionsService).run();
      } catch (err) {
        console.error('LandAuctions scrape failed:', err);
      }
    }

    if (target === 'all' || target === 'bid-cars') {
      try {
        await app.get(BidCarsService).run();
      } catch (err) {
        console.error('BidCars scrape failed:', err);
      }
    }

    if (target === 'all' || target === 'kufar') {
      try {
        await app.get(KufarService).run();
      } catch (err) {
        console.error('Kufar scrape failed:', err);
      }
    }
  } finally {
    await app.close();
  }
}

bootstrap().catch(err => {
  console.error('Scrape failed:', err);
  process.exit(1);
});
