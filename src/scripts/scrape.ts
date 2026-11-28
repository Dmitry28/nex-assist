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
 *   npm run scrape:idriver      # idriver only
 *   npm run scrape:razborf      # razborf only
 *   npm run scrape:kufar        # kufar only
 *   npm run scrape:realt        # realt only
 *   npm run scrape townhouses   # townhouses only
 *
 * TODO: replace with a proper persistent deployment — see _TODO.md in the
 * land-auctions module.
 */
import { NestFactory } from '@nestjs/core';
import { withTimeout } from '../common/utils/with-timeout';
import { AppModule } from '../app.module';
import { AvByService } from '../modules/av-by/av-by.service';
import { BamperService } from '../modules/bamper/bamper.service';
import { BidCarsService } from '../modules/bid-cars/bid-cars.service';
import { GhbService } from '../modules/ghb/ghb.service';
import { IdriverService } from '../modules/idriver/idriver.service';
import { RazborfService } from '../modules/razborf/razborf.service';
import { KufarService } from '../modules/kufar/kufar.service';
import { KufarRentFlatService } from '../modules/kufar-rent-flat/kufar-rent-flat.service';
import { KufarRentLongService } from '../modules/kufar-rent-long/kufar-rent-long.service';
import { LandAuctionsService } from '../modules/land-auctions/land-auctions.service';
import { MostyJobsService } from '../modules/mosty-jobs/mosty-jobs.service';
import { PogoranyService } from '../modules/pogorany/pogorany.service';
import { RealtService } from '../modules/realt/realt.service';
import { TownhousesService } from '../modules/townhouses/townhouses.service';

/**
 * Wall-clock cap per module. The services' own watchdogs only release their lock — they do not
 * stop the run — so one hung browser (27.11: GCN, after a 600s watchdog) held the whole job
 * until GitHub cancelled it 6 hours later and every module after it never ran.
 */
const MODULE_TIMEOUT_MS = 20 * 60 * 1000;

/** How long `app.close()` may take before we stop waiting for a stuck browser to shut down. */
const CLOSE_TIMEOUT_MS = 30_000;

type Module =
  | 'land'
  | 'bid-cars'
  | 'kufar'
  | 'kufar-rent-flat'
  | 'kufar-rent-long'
  | 'realt'
  | 'av-by'
  | 'bamper'
  | 'idriver'
  | 'razborf'
  | 'pogorany'
  | 'ghb'
  | 'mosty-jobs'
  | 'townhouses'
  | 'all';

function parseModule(): Module {
  const arg = process.argv[2];
  if (!arg || arg === 'all') return 'all';
  if (
    arg === 'land' ||
    arg === 'bid-cars' ||
    arg === 'kufar' ||
    arg === 'kufar-rent-flat' ||
    arg === 'kufar-rent-long' ||
    arg === 'realt' ||
    arg === 'av-by' ||
    arg === 'bamper' ||
    arg === 'idriver' ||
    arg === 'razborf' ||
    arg === 'pogorany' ||
    arg === 'ghb' ||
    arg === 'mosty-jobs' ||
    arg === 'townhouses'
  )
    return arg;
  console.error(
    `Unknown module: "${arg}". Valid options: land, bid-cars, kufar, kufar-rent-flat, kufar-rent-long, realt, av-by, bamper, idriver, razborf, pogorany, ghb, mosty-jobs`,
  );
  process.exit(1);
}

/** Run one module; a failure or a hang is logged and must not stop the modules after it. */
async function runModule(name: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await withTimeout(run(), MODULE_TIMEOUT_MS, name);
  } catch (err) {
    console.error(`${name} scrape failed:`, err);
  }
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
      await runModule('LandAuctions', () => app.get(LandAuctionsService).run());
    }

    if (target === 'all' || target === 'bid-cars') {
      await runModule('BidCars', () => app.get(BidCarsService).run());
    }

    if (target === 'all' || target === 'kufar') {
      await runModule('Kufar', () => app.get(KufarService).run());
    }

    if (target === 'all' || target === 'kufar-rent-flat') {
      await runModule('KufarRentFlat', () => app.get(KufarRentFlatService).run());
    }

    if (target === 'all' || target === 'kufar-rent-long') {
      await runModule('KufarRentLong', () => app.get(KufarRentLongService).run());
    }

    if (target === 'all' || target === 'realt') {
      await runModule('Realt', () => app.get(RealtService).run());
    }

    if (target === 'all' || target === 'av-by') {
      await runModule('AvBy', () => app.get(AvByService).run());
    }

    if (target === 'all' || target === 'bamper') {
      await runModule('Bamper', () => app.get(BamperService).run());
    }

    if (target === 'all' || target === 'idriver') {
      await runModule('Idriver', () => app.get(IdriverService).run());
    }

    if (target === 'all' || target === 'razborf') {
      await runModule('Razborf', () => app.get(RazborfService).run());
    }

    if (target === 'all' || target === 'pogorany') {
      await runModule('Pogorany', () => app.get(PogoranyService).run());
    }

    if (target === 'all' || target === 'townhouses') {
      await runModule('Townhouses', () => app.get(TownhousesService).run());
    }

    if (target === 'all' || target === 'ghb') {
      await runModule('Ghb', () => app.get(GhbService).run());
    }

    if (target === 'all' || target === 'mosty-jobs') {
      await runModule('MostyJobs', () => app.get(MostyJobsService).run());
    }
  } finally {
    try {
      await withTimeout(app.close(), CLOSE_TIMEOUT_MS, 'app.close');
    } catch (err) {
      console.error('Shutdown failed:', err);
    }
  }
}

bootstrap()
  // An abandoned (timed-out) module may still hold a Chrome process and keep the event loop
  // alive, so exit explicitly instead of waiting for it to drain.
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Scrape failed:', err);
    process.exit(1);
  });
