import { ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { SnapshotService } from '../../../common/snapshot.service';
import { BidCarsService } from '../bid-cars.service';
import { isCarListing, isRemovedCarListing } from '../dto/car-listing.dto';
import type { CarListing, RemovedCarListing } from '../dto/car-listing.dto';
import { BidCarsParserService } from '../bid-cars-parser.service';
import { BidCarsNotifierService } from '../bid-cars-notifier.service';
import { DATA_FILES } from '../constants';
import { carA, carB, carBRemoved, carBRemovedExpired, carBEnded } from './fixtures/car-listings';

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

describe('isCarListing', () => {
  it('returns true for valid listing', () =>
    expect(isCarListing({ link: 'https://bid.cars/ru/lot/1/' })).toBe(true));
  it('returns true with optional fields present', () =>
    expect(
      isCarListing({ link: 'https://bid.cars/ru/lot/1/', vin: 'ABC', currentBid: '$1000' }),
    ).toBe(true));
  it('returns false for null', () => expect(isCarListing(null)).toBe(false));
  it('returns false for missing link', () => expect(isCarListing({ vin: 'ABC' })).toBe(false));
  it('returns false when link is not a string', () =>
    expect(isCarListing({ link: 123 })).toBe(false));
});

describe('isRemovedCarListing', () => {
  it('returns true when removedAt is a string', () =>
    expect(
      isRemovedCarListing({
        link: 'https://bid.cars/ru/lot/1/',
        removedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toBe(true));
  it('returns false when removedAt is missing', () =>
    expect(isRemovedCarListing({ link: 'https://bid.cars/ru/lot/1/' })).toBe(false));
  it('returns false when removedAt is not a string', () =>
    expect(isRemovedCarListing({ link: 'https://bid.cars/ru/lot/1/', removedAt: 123 })).toBe(
      false,
    ));
  it('returns false for invalid base listing', () =>
    expect(isRemovedCarListing({ removedAt: '2026-01-01T00:00:00.000Z' })).toBe(false));
});

// ---------------------------------------------------------------------------
// BidCarsService — scrape orchestration
// ---------------------------------------------------------------------------

describe('BidCarsService — scrape', () => {
  let module: TestingModule;
  let service: BidCarsService;
  let parser: jest.Mocked<BidCarsParserService>;
  let snapshot: jest.Mocked<SnapshotService>;
  let notifier: jest.Mocked<BidCarsNotifierService>;

  beforeEach(async () => {
    // Suppress cron scheduling — unit tests don't need a real timer running
    jest.spyOn(BidCarsService.prototype, 'onModuleInit').mockImplementation(() => {});

    module = await Test.createTestingModule({
      providers: [
        BidCarsService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockImplementation((key: string) => {
              if (key === 'bidCars.scrapeUrl') return 'https://bid.cars/active';
              throw new Error(`Unexpected config key in test: ${key}`);
            }),
            get: jest.fn().mockImplementation((key: string) => {
              if (key === 'bidCars.endedUrl') return '';
              if (key === 'bidCars.archivedUrl') return '';
              return '';
            }),
          },
        },
        {
          provide: SchedulerRegistry,
          useValue: {
            addCronJob: jest.fn(),
            deleteCronJob: jest.fn(),
            doesExist: jest.fn().mockReturnValue(false),
          },
        },
        {
          provide: BidCarsParserService,
          useValue: { fetchListings: jest.fn() },
        },
        {
          provide: SnapshotService,
          useValue: { read: jest.fn(), write: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: BidCarsNotifierService,
          useValue: {
            notifyRunResult: jest.fn().mockResolvedValue(undefined),
            notifyError: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(BidCarsService);
    parser = module.get(BidCarsParserService);
    snapshot = module.get(SnapshotService);
    notifier = module.get(BidCarsNotifierService);
  });

  afterEach(async () => {
    await module.close();
  });

  /**
   * Configure what fetchListings / snapshot.read will return for one scrape cycle.
   */
  function setupRun(opts: {
    current: CarListing[];
    previousAll?: CarListing[];
    previousRemoved?: RemovedCarListing[];
  }): void {
    const { current, previousAll = [], previousRemoved = [] } = opts;
    parser.fetchListings.mockResolvedValue(current);
    (snapshot.read as jest.Mock).mockImplementation((filePath: string) => {
      if (filePath === DATA_FILES.all) return Promise.resolve(previousAll);
      if (filePath === DATA_FILES.removed) return Promise.resolve(previousRemoved);
      return Promise.resolve([]);
    });
  }

  /** Return the data array written for a specific snapshot file path. */
  function writtenFor<T = unknown>(filePath: string): T {
    const call = (snapshot.write as jest.Mock).mock.calls.find(
      ([path]: [string]) => path === filePath,
    );
    return call?.[1] as T;
  }

  // -------------------------------------------------------------------------
  // Diff logic
  // -------------------------------------------------------------------------

  describe('diff logic', () => {
    it('first run: all current listings are new', async () => {
      setupRun({ current: [carA, carB] });

      const result = await service.run();

      expect(result.total).toBe(2);
      expect(result.newListings).toEqual([carA, carB]);
      expect(result.removedListings).toHaveLength(0);
      expect(result.soldPriceUpdates).toHaveLength(0);
    });

    it('no changes: empty diff', async () => {
      setupRun({ current: [carA, carB], previousAll: [carA, carB] });

      const result = await service.run();

      expect(result.newListings).toHaveLength(0);
      expect(result.removedListings).toHaveLength(0);
    });

    it('new listing appears', async () => {
      setupRun({ current: [carA, carB], previousAll: [carA] });

      const result = await service.run();

      expect(result.newListings).toEqual([carB]);
      expect(result.removedListings).toHaveLength(0);
    });

    it('listing disappears — no endedUrl → no lookups, just registered as removed', async () => {
      setupRun({ current: [carA], previousAll: [carA, carB] });

      const result = await service.run();

      expect(result.newListings).toHaveLength(0);
      expect(result.removedListings).toHaveLength(1);
      expect(result.removedListings[0].link).toBe(carB.link);
    });

    it('persists current listings to snapshot after run', async () => {
      setupRun({ current: [carA, carB] });

      await service.run();

      expect(writtenFor(DATA_FILES.all)).toEqual([carA, carB]);
      expect(writtenFor(DATA_FILES.new)).toEqual([carA, carB]);
    });
  });

  // -------------------------------------------------------------------------
  // Removed listings & sold price lookup
  // -------------------------------------------------------------------------

  describe('removed listings', () => {
    it('newly removed listing → registered in removed map with removedAt timestamp', async () => {
      setupRun({ current: [carA], previousAll: [carA, carB] });

      await service.run();

      const finalRemoved = writtenFor<RemovedCarListing[]>(DATA_FILES.removed);
      expect(finalRemoved).toHaveLength(1);
      expect(finalRemoved[0].link).toBe(carB.link);
      expect(finalRemoved[0].removedAt).toBeTruthy();
    });

    it('when endedUrl configured and VIN matches → soldPrice enriched', async () => {
      module.get(ConfigService).get = jest.fn().mockImplementation((key: string) => {
        if (key === 'bidCars.endedUrl') return 'https://bid.cars/ended';
        if (key === 'bidCars.archivedUrl') return '';
        return '';
      });

      setupRun({ current: [carA], previousAll: [carA, carB] });
      // fetchListings is called twice: once for scrapeUrl, once for endedUrl
      parser.fetchListings
        .mockResolvedValueOnce([carA]) // scrapeUrl
        .mockResolvedValueOnce([carBEnded]); // endedUrl

      const result = await service.run();

      expect(result.removedListings[0].soldPrice).toBe(carBEnded.currentBid);
    });

    it('newly removed with sold price found immediately → toNotifyRemoval includes soldPrice', async () => {
      module.get(ConfigService).get = jest.fn().mockImplementation((key: string) => {
        if (key === 'bidCars.endedUrl') return 'https://bid.cars/ended';
        if (key === 'bidCars.archivedUrl') return '';
        return '';
      });

      setupRun({ current: [carA], previousAll: [carA, carB] });
      parser.fetchListings.mockResolvedValueOnce([carA]).mockResolvedValueOnce([carBEnded]);

      const result = await service.run();

      expect(result.removedListings).toHaveLength(1);
      expect(result.removedListings[0].soldPrice).toBe('$2 500');
      expect(result.soldPriceUpdates).toHaveLength(0);
    });

    it('removed already notified + soldPrice found later → toNotifySold', async () => {
      module.get(ConfigService).get = jest.fn().mockImplementation((key: string) => {
        if (key === 'bidCars.endedUrl') return 'https://bid.cars/ended';
        if (key === 'bidCars.archivedUrl') return '';
        return '';
      });

      // carBRemoved already has removalNotifiedAt set (notified on a previous run)
      const carBAlreadyNotified: RemovedCarListing = {
        ...carBRemoved,
        removalNotifiedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      };

      setupRun({ current: [carA], previousAll: [carA], previousRemoved: [carBAlreadyNotified] });
      parser.fetchListings.mockResolvedValueOnce([carA]).mockResolvedValueOnce([carBEnded]); // sold price found this run

      const result = await service.run();

      expect(result.soldPriceUpdates).toHaveLength(1);
      expect(result.soldPriceUpdates[0].link).toBe(carB.link);
      expect(result.soldPriceUpdates[0].soldPrice).toBe('$2 500');
      expect(result.removedListings).toHaveLength(0);
    });

    it('removed past TTL (no soldNotifiedAt) → excluded from pending, dropped from finalRemoved', async () => {
      setupRun({ current: [carA], previousAll: [carA], previousRemoved: [carBRemovedExpired] });

      await service.run();

      const finalRemoved = writtenFor<RemovedCarListing[]>(DATA_FILES.removed);
      expect(finalRemoved.find(r => r.link === carB.link)).toBeUndefined();
    });

    it('removed past TTL with soldNotifiedAt → kept for statistics', async () => {
      const carBSettled: RemovedCarListing = {
        ...carBRemovedExpired,
        soldPrice: '$2 500',
        soldNotifiedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      };

      setupRun({ current: [carA], previousAll: [carA], previousRemoved: [carBSettled] });

      await service.run();

      const finalRemoved = writtenFor<RemovedCarListing[]>(DATA_FILES.removed);
      expect(finalRemoved.find(r => r.link === carB.link)).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Notification and persist behavior
  // -------------------------------------------------------------------------

  describe('notify and persist', () => {
    it('snapshot NOT written when notifyRunResult throws', async () => {
      setupRun({ current: [carA] });
      notifier.notifyRunResult.mockRejectedValue(new Error('Telegram down'));

      await expect(service.run()).rejects.toThrow('Telegram down');

      expect(snapshot.write).not.toHaveBeenCalled();
    });

    it('isRunning reset after notification throws', async () => {
      setupRun({ current: [carA] });
      notifier.notifyRunResult.mockRejectedValueOnce(new Error('Telegram down'));
      notifier.notifyRunResult.mockResolvedValue(undefined); // second run succeeds

      await expect(service.run()).rejects.toThrow('Telegram down');

      // Should not throw ConflictException on the next run
      setupRun({ current: [carA] });
      await expect(service.run()).resolves.not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Concurrent run guard
  // -------------------------------------------------------------------------

  describe('run guard', () => {
    it('throws ConflictException when a run is already in progress', async () => {
      // Hold fetchListings until we've made our assertion, then release to avoid open handles
      let unblock!: (listings: CarListing[]) => void;
      parser.fetchListings.mockReturnValue(
        new Promise(resolve => {
          unblock = resolve;
        }),
      );
      (snapshot.read as jest.Mock).mockResolvedValue([]);

      const firstRun = service.run(); // sets isRunning = true synchronously before first await
      await Promise.resolve(); // flush microtask queue

      await expect(service.run()).rejects.toThrow(ConflictException);

      // Release the blocked run so the watchdog timer is cleared and the module can close cleanly
      unblock([]);
      await firstRun.catch(() => {});
    });
  });
});
