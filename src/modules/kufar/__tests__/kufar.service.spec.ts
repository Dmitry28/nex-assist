import { ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { SnapshotService } from '../../../common/snapshot.service';
import { KufarService } from '../kufar.service';
import { isKufarSnapshotEntry } from '../dto/kufar-listing.dto';
import { KufarParserService } from '../kufar-parser.service';
import { KufarNotifierService, type KufarNotifyResult } from '../kufar-notifier.service';
import type { KufarFeedConfig } from '../../../config/kufar.config';
import type { KufarListing, KufarSnapshotEntry } from '../dto/kufar-listing.dto';
import {
  feed1,
  feed2,
  listingA,
  listingB,
  listingBPriceChanged,
  snapshotA,
  snapshotB,
} from './fixtures/kufar-listings';

jest.mock('../../../common/utils/sleep', () => ({ sleep: jest.fn().mockResolvedValue(undefined) }));

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

describe('isKufarSnapshotEntry', () => {
  it('returns true for a valid entry', () =>
    expect(
      isKufarSnapshotEntry({
        adId: 1,
        listTime: '2026-01-01T00:00:00.000Z',
        firstSeenAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toBe(true));

  it('returns false for null', () => expect(isKufarSnapshotEntry(null)).toBe(false));

  it('returns false when adId is missing', () =>
    expect(
      isKufarSnapshotEntry({
        listTime: '2026-01-01T00:00:00.000Z',
        firstSeenAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toBe(false));

  it('returns false when adId is not a number', () =>
    expect(
      isKufarSnapshotEntry({
        adId: '1',
        listTime: '2026-01-01T00:00:00.000Z',
        firstSeenAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toBe(false));

  it('returns false when firstSeenAt is missing', () =>
    expect(
      isKufarSnapshotEntry({
        adId: 1,
        listTime: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toBe(false));
});

// ---------------------------------------------------------------------------
// KufarService — scrape orchestration
// ---------------------------------------------------------------------------

describe('KufarService — scrape', () => {
  let module: TestingModule;
  let service: KufarService;
  let parser: jest.Mocked<KufarParserService>;
  let snapshot: jest.Mocked<SnapshotService>;
  let notifier: jest.Mocked<KufarNotifierService>;
  let config: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    jest.spyOn(KufarService.prototype, 'onModuleInit').mockImplementation(() => {});

    module = await Test.createTestingModule({
      providers: [
        KufarService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              if (key === 'kufar.feeds') return [feed1];
              return undefined;
            }),
          },
        },
        {
          provide: SchedulerRegistry,
          useValue: { doesExist: jest.fn().mockReturnValue(false), deleteCronJob: jest.fn() },
        },
        {
          provide: KufarParserService,
          useValue: { fetchFeed: jest.fn() },
        },
        {
          provide: SnapshotService,
          useValue: { read: jest.fn(), write: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: KufarNotifierService,
          useValue: {
            notifyRunResult: jest
              .fn()
              .mockResolvedValue({ notifiedNew: new Map(), notifiedPriceChanges: new Map() }),
            notifyError: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(KufarService);
    parser = module.get(KufarParserService);
    snapshot = module.get(SnapshotService);
    notifier = module.get(KufarNotifierService);
    config = module.get(ConfigService);
  });

  afterEach(async () => {
    await module.close();
  });

  function setupRun(opts: {
    listings?: KufarListing[];
    truncated?: boolean;
    previousEntries?: KufarSnapshotEntry[];
    feeds?: KufarFeedConfig[];
    notifyResult?: KufarNotifyResult;
  }): void {
    const {
      listings = [],
      truncated = false,
      previousEntries = [],
      feeds = [feed1],
      notifyResult,
    } = opts;
    (config.get as jest.Mock).mockImplementation((key: string) => {
      if (key === 'kufar.feeds') return feeds;
      return undefined;
    });
    parser.fetchFeed.mockResolvedValue({ listings, truncated });
    (snapshot.read as jest.Mock).mockResolvedValue(previousEntries);
    if (notifyResult) {
      notifier.notifyRunResult.mockResolvedValue(notifyResult);
    }
  }

  // -------------------------------------------------------------------------
  // No feeds configured
  // -------------------------------------------------------------------------

  describe('no feeds configured', () => {
    it('returns { feeds: [] } and makes no parser or snapshot calls', async () => {
      setupRun({ feeds: [] });

      const result = await service.run();

      expect(result).toEqual({ feeds: [] });
      expect(parser.fetchFeed).not.toHaveBeenCalled();
      expect(snapshot.read).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Diff logic
  // -------------------------------------------------------------------------

  describe('diff logic', () => {
    it('first run: all current listings are new', async () => {
      setupRun({ listings: [listingA, listingB] });

      const result = await service.run();

      expect(result.feeds[0].newListings).toEqual([listingA, listingB]);
      expect(result.feeds[0].priceChanges).toHaveLength(0);
    });

    it('no changes (same adId, same price) → bumped, no new, no price changes', async () => {
      setupRun({ listings: [listingA], previousEntries: [snapshotA] });

      const result = await service.run();

      expect(result.feeds[0].newListings).toHaveLength(0);
      expect(result.feeds[0].priceChanges).toHaveLength(0);
    });

    it('new listing appears', async () => {
      setupRun({ listings: [listingA, listingB], previousEntries: [snapshotA] });

      const result = await service.run();

      expect(result.feeds[0].newListings).toEqual([listingB]);
      expect(result.feeds[0].priceChanges).toHaveLength(0);
    });

    it('price change detected when both BYN and USD changed', async () => {
      setupRun({ listings: [listingBPriceChanged], previousEntries: [snapshotB] });

      const result = await service.run();

      expect(result.feeds[0].priceChanges).toHaveLength(1);
      expect(result.feeds[0].priceChanges[0].listing.adId).toBe(listingBPriceChanged.adId);
      expect(result.feeds[0].priceChanges[0].oldPriceByn).toBe(snapshotB.priceByn);
      expect(result.feeds[0].priceChanges[0].oldPriceUsd).toBe(snapshotB.priceUsd);
    });

    it('only BYN changed (exchange rate fluctuation) → not a price change', async () => {
      const listingBynOnly: KufarListing = { ...listingB, priceByn: 28000 }; // USD same
      setupRun({ listings: [listingBynOnly], previousEntries: [snapshotB] });

      const result = await service.run();

      expect(result.feeds[0].priceChanges).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Notification-gated persistence
  // -------------------------------------------------------------------------

  describe('notification-gated persistence', () => {
    it('new listing notified → persisted in snapshot with firstSeenAt/lastSeenAt', async () => {
      const notifyResult: KufarNotifyResult = {
        notifiedNew: new Map([[feed1.key, new Set([listingA.adId])]]),
        notifiedPriceChanges: new Map(),
      };
      setupRun({ listings: [listingA], notifyResult });

      await service.run();

      const written = (snapshot.write as jest.Mock).mock.calls[0][1] as KufarSnapshotEntry[];
      const entry = written.find(e => e.adId === listingA.adId);
      expect(entry).toBeDefined();
      expect(entry?.firstSeenAt).toBeTruthy();
      expect(entry?.lastSeenAt).toBeTruthy();
    });

    it('new listing NOT notified → NOT added to snapshot', async () => {
      // notifiedNew map is empty — notification was not delivered
      setupRun({ listings: [listingA] });

      await service.run();

      const written = (snapshot.write as jest.Mock).mock.calls[0][1] as KufarSnapshotEntry[];
      expect(written.find(e => e.adId === listingA.adId)).toBeUndefined();
    });

    it('price change notified → snapshot updated with new price', async () => {
      const notifyResult: KufarNotifyResult = {
        notifiedNew: new Map(),
        notifiedPriceChanges: new Map([[feed1.key, new Set([listingBPriceChanged.adId])]]),
      };
      setupRun({ listings: [listingBPriceChanged], previousEntries: [snapshotB], notifyResult });

      await service.run();

      const written = (snapshot.write as jest.Mock).mock.calls[0][1] as KufarSnapshotEntry[];
      const entry = written.find(e => e.adId === listingBPriceChanged.adId);
      expect(entry?.priceByn).toBe(listingBPriceChanged.priceByn);
      expect(entry?.priceUsd).toBe(listingBPriceChanged.priceUsd);
    });

    it('price change NOT notified → snapshot keeps old price, only lastSeenAt updated', async () => {
      // notifiedPriceChanges map is empty
      setupRun({ listings: [listingBPriceChanged], previousEntries: [snapshotB] });

      await service.run();

      const written = (snapshot.write as jest.Mock).mock.calls[0][1] as KufarSnapshotEntry[];
      const entry = written.find(e => e.adId === snapshotB.adId);
      expect(entry?.priceByn).toBe(snapshotB.priceByn);
      expect(entry?.priceUsd).toBe(snapshotB.priceUsd);
      expect(entry?.lastSeenAt).not.toBe(snapshotB.lastSeenAt);
    });

    it('bumped listing (same price) → always updates lastSeenAt', async () => {
      setupRun({ listings: [listingA], previousEntries: [snapshotA] });

      await service.run();

      const written = (snapshot.write as jest.Mock).mock.calls[0][1] as KufarSnapshotEntry[];
      const entry = written.find(e => e.adId === snapshotA.adId);
      expect(entry?.lastSeenAt).not.toBe(snapshotA.lastSeenAt);
    });
  });

  // -------------------------------------------------------------------------
  // Run guard
  // -------------------------------------------------------------------------

  describe('run guard', () => {
    it('throws ConflictException when already running', async () => {
      let unblock!: (value: { listings: KufarListing[]; truncated: boolean }) => void;
      parser.fetchFeed.mockReturnValue(
        new Promise(resolve => {
          unblock = resolve;
        }),
      );
      (snapshot.read as jest.Mock).mockResolvedValue([]);

      const firstRun = service.run();
      await Promise.resolve();

      await expect(service.run()).rejects.toThrow(ConflictException);

      unblock({ listings: [], truncated: false });
      await firstRun.catch(() => {});
    });
  });

  // -------------------------------------------------------------------------
  // Run result structure
  // -------------------------------------------------------------------------

  describe('run result structure', () => {
    it('result.feeds contains feedName, total, newListings, priceChanges', async () => {
      setupRun({ listings: [listingA, listingB] });

      const result = await service.run();

      expect(result.feeds).toHaveLength(1);
      const feedResult = result.feeds[0];
      expect(feedResult.feedName).toBe(feed1.key);
      expect(typeof feedResult.total).toBe('number');
      expect(Array.isArray(feedResult.newListings)).toBe(true);
      expect(Array.isArray(feedResult.priceChanges)).toBe(true);
    });

    it('processes multiple feeds', async () => {
      (config.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'kufar.feeds') return [feed1, feed2];
        return undefined;
      });
      parser.fetchFeed.mockResolvedValue({ listings: [listingA], truncated: false });
      (snapshot.read as jest.Mock).mockResolvedValue([]);

      const result = await service.run();

      expect(result.feeds).toHaveLength(2);
      expect(result.feeds[0].feedName).toBe(feed1.key);
      expect(result.feeds[1].feedName).toBe(feed2.key);
    });
  });
});
