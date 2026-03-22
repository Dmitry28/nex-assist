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
    // Run independently — one failure must not prevent the other from running
    const results = await Promise.allSettled([
      app.get(LandAuctionsService).run(),
      app.get(BidCarsService).run(),
    ]);
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length > 0) process.exit(1);
  } finally {
    await app.close();
  }
}

bootstrap().catch(err => {
  console.error('Scrape failed:', err);
  process.exit(1);
});
