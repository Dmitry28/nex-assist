/**
 * One-shot scrape script for CI / GitHub Actions.
 *
 * Bootstraps the NestJS application context (no HTTP server), runs all scrape
 * cycles sequentially, then exits. Used instead of the long-lived server when
 * the environment has no persistent host (e.g. a GitHub Actions runner).
 *
 * TODO: replace with a proper persistent deployment — see _TODO.md in the
 * land-auctions module.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { BidCarsService } from '../modules/bid-cars/bid-cars.service';
import { LandAuctionsService } from '../modules/land-auctions/land-auctions.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    await app.get(LandAuctionsService).run();
    await app.get(BidCarsService).run();
  } finally {
    await app.close();
  }
}

bootstrap().catch(err => {
  console.error('Scrape failed:', err);
  process.exit(1);
});
