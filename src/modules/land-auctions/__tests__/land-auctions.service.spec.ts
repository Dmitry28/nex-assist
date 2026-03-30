import { ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { SnapshotService } from '../../../common/snapshot.service';
import { LandAuctionsService } from '../land-auctions.service';
import { isListing, isArchivePendingItem } from '../dto/listing.dto';
import { GcnParserService } from '../gcn-parser.service';
import { ListingNotifierService } from '../listing-notifier.service';
import type { ArchivePendingItem, Listing } from '../dto/listing.dto';
import { DATA_FILES } from '../constants';
import {
  listingA,
  listingB,
  listingSpecial,
  pendingRecent,
  pendingExpired,
  salePricesB,
} from './fixtures/listings';

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

describe('isListing', () => {
  it('returns true for valid listing', () =>
    expect(isListing({ link: 'https://gcn.by/lot/1' })).toBe(true));
  it('returns true with optional fields present', () =>
    expect(isListing({ link: 'https://gcn.by/lot/1', title: 'Plot', price: '1000' })).toBe(true));
  it('returns false for null', () => expect(isListing(null)).toBe(false));
  it('returns false for missing link', () => expect(isListing({ title: 'Plot' })).toBe(false));
  it('returns false when link is not a string', () => expect(isListing({ link: 42 })).toBe(false));
  it('returns false for primitive', () => expect(isListing('string')).toBe(false));
});

describe('isArchivePendingItem', () => {
  const valid: ArchivePendingItem = {
    listing: { link: 'https://gcn.by/1' },
    removedAt: '2026-03-01T00:00:00.000Z',
  };
  it('returns true for valid item', () => expect(isArchivePendingItem(valid)).toBe(true));
  it('returns false for null', () => expect(isArchivePendingItem(null)).toBe(false));
  it('returns false when listing is invalid', () =>
    expect(isArchivePendingItem({ listing: { title: 'no link' }, removedAt: '2026-01-01' })).toBe(
      false,
    ));
  it('returns false when removedAt is missing', () =>
    expect(isArchivePendingItem({ listing: { link: 'https://gcn.by/1' } })).toBe(false));
  it('returns false when removedAt is not a string', () =>
    expect(isArchivePendingItem({ listing: { link: 'https://gcn.by/1' }, removedAt: 123 })).toBe(
      false,
    ));
});

// ---------------------------------------------------------------------------
// LandAuctionsService — scrape orchestration
// ---------------------------------------------------------------------------

describe('LandAuctionsService — scrape', () => {
  let module: TestingModule;
  let service: LandAuctionsService;
  let parser: jest.Mocked<GcnParserService>;
  let snapshot: jest.Mocked<SnapshotService>;
  let notifier: jest.Mocked<ListingNotifierService>;

  beforeEach(async () => {
    // Suppress cron scheduling — unit tests don't need a real timer running
    jest.spyOn(LandAuctionsService.prototype, 'onModuleInit').mockImplementation(() => {});

    module = await Test.createTestingModule({
      providers: [
        LandAuctionsService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockImplementation((key: string) => {
              if (key === 'landAuctions.scrapeCron') return '0 8 * * *';
              if (key === 'landAuctions.scrapeUrl') return 'https://gcn.by';
              throw new Error(`Unexpected config key in test: ${key}`);
            }),
            // ListingNotifierService reads chatId via get() — return empty so it skips real sends
            get: jest.fn().mockReturnValue(''),
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
          provide: GcnParserService,
          useValue: { fetchListings: jest.fn(), findSalePrices: jest.fn() },
        },
        {
          provide: SnapshotService,
          useValue: { read: jest.fn(), write: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: ListingNotifierService,
          useValue: {
            notifyRunResult: jest.fn().mockResolvedValue(undefined),
            notifyError: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(LandAuctionsService);
    parser = module.get(GcnParserService);
    snapshot = module.get(SnapshotService);
    notifier = module.get(ListingNotifierService);
  });

  afterEach(async () => {
    await module.close();
  });

  /**
   * Configure what fetchListings / snapshot.read / findSalePrices will return
   * for one scrape cycle.
   */
  function setupRun(opts: {
    current: Listing[];
    previous?: Listing[];
    pending?: ArchivePendingItem[];
    salePrices?: Map<string, string>;
  }): void {
    const { current, previous = [], pending = [], salePrices = new Map() } = opts;

    parser.fetchListings.mockResolvedValue(current);
    (snapshot.read as jest.Mock).mockImplementation((filePath: string) => {
      if (filePath === DATA_FILES.all) return Promise.resolve(previous);
      if (filePath === DATA_FILES.archivePending) return Promise.resolve(pending);
      return Promise.resolve([]);
    });
    parser.findSalePrices.mockResolvedValue(salePrices);
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
      setupRun({ current: [listingA, listingB] });

      const result = await service.run();

      expect(result.total).toBe(2);
      expect(result.newListings).toEqual([listingA, listingB]);
      expect(result.removedListings).toHaveLength(0);
      expect(result.soldListings).toHaveLength(0);
    });

    it('no changes: empty diff', async () => {
      setupRun({ current: [listingA, listingB], previous: [listingA, listingB] });

      const result = await service.run();

      expect(result.newListings).toHaveLength(0);
      expect(result.removedListings).toHaveLength(0);
    });

    it('new listing appears', async () => {
      setupRun({ current: [listingA, listingB], previous: [listingA] });

      const result = await service.run();

      expect(result.newListings).toEqual([listingB]);
      expect(result.removedListings).toHaveLength(0);
    });

    it('listing disappears', async () => {
      setupRun({ current: [listingA], previous: [listingA, listingB] });

      const result = await service.run();

      expect(result.newListings).toHaveLength(0);
      expect(result.removedListings).toHaveLength(1);
      expect(result.removedListings[0].link).toBe(listingB.link);
    });

    it('persists current listings to snapshot after run', async () => {
      setupRun({ current: [listingA, listingB] });

      await service.run();

      expect(writtenFor(DATA_FILES.all)).toEqual([listingA, listingB]);
      expect(writtenFor(DATA_FILES.new)).toEqual([listingA, listingB]);
    });

    it('notifies Telegram with the full result', async () => {
      setupRun({ current: [listingA, listingB], previous: [listingA] });

      const result = await service.run();

      expect(notifier.notifyRunResult).toHaveBeenCalledWith(result);
    });
  });

  // -------------------------------------------------------------------------
  // Removed listings + archive lookup
  // -------------------------------------------------------------------------

  describe('removed listings', () => {
    it('removed without sale price → added to archive pending', async () => {
      setupRun({ current: [listingA], previous: [listingA, listingB] });

      await service.run();

      const pending = writtenFor<ArchivePendingItem[]>(DATA_FILES.archivePending);
      expect(pending).toHaveLength(1);
      expect(pending[0].listing.link).toBe(listingB.link);
      expect(pending[0].removedAt).toBeTruthy();
    });

    it('removed listing is passed to findSalePrices', async () => {
      setupRun({ current: [listingA], previous: [listingA, listingB] });

      await service.run();

      expect(parser.findSalePrices).toHaveBeenCalledWith(expect.arrayContaining([listingB]));
    });

    it('removed with sale price found immediately → enriched, not added to pending', async () => {
      setupRun({ current: [listingA], previous: [listingA, listingB], salePrices: salePricesB });

      const result = await service.run();

      expect(result.removedListings[0].salePrice).toBe('25 тыс. руб.');
      const pending = writtenFor<ArchivePendingItem[]>(DATA_FILES.archivePending);
      expect(pending).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Archive pending queue
  // -------------------------------------------------------------------------

  describe('archive pending', () => {
    it('previously pending listing gets sale price → appears in soldListings, removed from pending', async () => {
      setupRun({
        current: [listingA],
        previous: [listingA],
        pending: [pendingRecent],
        salePrices: salePricesB,
      });

      const result = await service.run();

      expect(result.soldListings).toHaveLength(1);
      expect(result.soldListings[0].link).toBe(listingB.link);
      expect(result.soldListings[0].salePrice).toBe('25 тыс. руб.');

      const pending = writtenFor<ArchivePendingItem[]>(DATA_FILES.archivePending);
      expect(pending).toHaveLength(0);
    });

    it('previously pending listing still no price → stays in pending', async () => {
      setupRun({ current: [listingA], previous: [listingA], pending: [pendingRecent] });

      const result = await service.run();

      expect(result.soldListings).toHaveLength(0);

      const pending = writtenFor<ArchivePendingItem[]>(DATA_FILES.archivePending);
      expect(pending).toHaveLength(1);
      expect(pending[0].listing.link).toBe(listingB.link);
    });

    it('pending item past TTL → silently dropped', async () => {
      setupRun({ current: [listingA], previous: [listingA], pending: [pendingExpired] });

      const result = await service.run();

      expect(result.soldListings).toHaveLength(0);

      const pending = writtenFor<ArchivePendingItem[]>(DATA_FILES.archivePending);
      expect(pending).toHaveLength(0);
    });

    it('newly removed listing and stale pending are both passed to findSalePrices', async () => {
      // listingA removed from current, listingB in pending
      setupRun({ current: [], previous: [listingA], pending: [pendingRecent] });

      await service.run();

      expect(parser.findSalePrices).toHaveBeenCalledWith(
        expect.arrayContaining([listingA, listingB]),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Special listings (Заболоть area)
  // -------------------------------------------------------------------------

  describe('special listings (Заболоть)', () => {
    it('detects new special listing', async () => {
      setupRun({ current: [listingA, listingSpecial], previous: [listingA] });

      const result = await service.run();

      expect(result.specialListings).toEqual([listingSpecial]);
      expect(result.newSpecialListings).toEqual([listingSpecial]);
    });

    it('existing special listing is not in newSpecialListings', async () => {
      setupRun({ current: [listingA, listingSpecial], previous: [listingA, listingSpecial] });

      const result = await service.run();

      expect(result.specialListings).toEqual([listingSpecial]);
      expect(result.newSpecialListings).toHaveLength(0);
    });

    it('non-special listing is not in specialListings', async () => {
      setupRun({ current: [listingA, listingB], previous: [] });

      const result = await service.run();

      expect(result.specialListings).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Concurrent run guard
  // -------------------------------------------------------------------------

  describe('run guard', () => {
    it('throws ConflictException when a run is already in progress', async () => {
      // Hold fetchListings until we've made our assertion, then release to avoid open handles
      let unblock!: (listings: Listing[]) => void;
      parser.fetchListings.mockReturnValue(
        new Promise(resolve => {
          unblock = resolve;
        }),
      );
      (snapshot.read as jest.Mock).mockResolvedValue([]);
      parser.findSalePrices.mockResolvedValue(new Map());

      const firstRun = service.run(); // sets isRunning = true synchronously before first await
      await Promise.resolve(); // flush microtask queue

      await expect(service.run()).rejects.toThrow(ConflictException);

      // Release the blocked run so the watchdog timer is cleared and the module can close cleanly
      unblock([]);
      await firstRun.catch(() => {});
    });
  });

  // -------------------------------------------------------------------------
  // Notify before persist guarantee
  // -------------------------------------------------------------------------

  describe('notify before persist', () => {
    it('does not write snapshots when notification throws', async () => {
      setupRun({ current: [listingA] });
      notifier.notifyRunResult.mockRejectedValue(new Error('Telegram down'));

      await expect(service.run()).rejects.toThrow('Telegram down');

      expect(snapshot.write).not.toHaveBeenCalled();
    });

    it('resets isRunning lock even when notification throws', async () => {
      setupRun({ current: [listingA] });
      notifier.notifyRunResult.mockRejectedValueOnce(new Error('Telegram down'));
      notifier.notifyRunResult.mockResolvedValue(undefined); // second run succeeds

      await expect(service.run()).rejects.toThrow('Telegram down');

      // Should not throw ConflictException on the next run
      await expect(service.run()).resolves.not.toThrow();
    });
  });
});
