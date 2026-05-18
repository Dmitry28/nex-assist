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
 *   npm run scrape:realt        # realt only
 *
 * TODO: replace with a proper persistent deployment — see _TODO.md in the
 * land-auctions module.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AvByService } from '../modules/av-by/av-by.service';
import { BidCarsService } from '../modules/bid-cars/bid-cars.service';
import { KufarService } from '../modules/kufar/kufar.service';
import { KufarRentFlatService } from '../modules/kufar-rent-flat/kufar-rent-flat.service';
import { LandAuctionsService } from '../modules/land-auctions/land-auctions.service';
import { PogoranyService } from '../modules/pogorany/pogorany.service';
import { RealtService } from '../modules/realt/realt.service';

type Module =
  | 'land'
  | 'bid-cars'
  | 'kufar'
  | 'kufar-rent-flat'
  | 'realt'
  | 'av-by'
  | 'pogorany'
  | 'all';

function parseModule(): Module {
  const arg = process.argv[2];
  if (!arg || arg === 'all') return 'all';
  if (
    arg === 'land' ||
    arg === 'bid-cars' ||
    arg === 'kufar' ||
    arg === 'kufar-rent-flat' ||
    arg === 'realt' ||
    arg === 'av-by' ||
    arg === 'pogorany'
  )
    return arg;
  console.error(
    `Unknown module: "${arg}". Valid options: land, bid-cars, kufar, kufar-rent-flat, realt, av-by, pogorany`,
  );
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

    if (target === 'all' || target === 'kufar-rent-flat') {
      try {
        await app.get(KufarRentFlatService).run();
      } catch (err) {
        console.error('KufarRentFlat scrape failed:', err);
      }
    }

    if (target === 'all' || target === 'realt') {
      try {
        await app.get(RealtService).run();
      } catch (err) {
        console.error('Realt scrape failed:', err);
      }
    }

    if (target === 'all' || target === 'av-by') {
      try {
        await app.get(AvByService).run();
      } catch (err) {
        console.error('AvBy scrape failed:', err);
      }
    }

    if (target === 'all' || target === 'pogorany') {
      try {
        await app.get(PogoranyService).run();
      } catch (err) {
        console.error('Pogorany scrape failed:', err);
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
