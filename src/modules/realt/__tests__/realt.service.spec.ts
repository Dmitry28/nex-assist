import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, type TestingModule } from '@nestjs/testing';
import { SnapshotService } from '../../../common/snapshot.service';
import type { RealtFeedConfig } from '../../../config/realt.config';
import { isRealtSnapshotEntry } from '../dto/realt-listing.dto';
import type { RealtListing, RealtSnapshotEntry } from '../dto/realt-listing.dto';
import { RealtNotifierService, type RealtNotifyResult } from '../realt-notifier.service';
import { RealtParserService } from '../realt-parser.service';
import { RealtService } from '../realt.service';
import {
  feed1,
  feed2,
  listingA,
  listingB,
  listingBPriceChanged,
  snapshotA,
  snapshotB,
} from './fixtures/realt-listings';

jest.mock('../../../common/utils/sleep', () => ({ sleep: jest.fn().mockResolvedValue(undefined) }));

describe('isRealtSnapshotEntry', () => {
  it('returns true for a valid entry', () =>
    expect(
      isRealtSnapshotEntry({
        adId: 1,
        listTime: '2026-01-01T00:00:00.000Z',
        firstSeenAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toBe(true));

  it('returns false for null', () => expect(isRealtSnapshotEntry(null)).toBe(false));

  it('returns false when adId is missing', () =>
    expect(
      isRealtSnapshotEntry({
        listTime: '2026-01-01T00:00:00.000Z',
        firstSeenAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toBe(false));

  it('returns false when adId is not a number', () =>
    expect(
      isRealtSnapshotEntry({
        adId: '1',
        listTime: '2026-01-01T00:00:00.000Z',
        firstSeenAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toBe(false));
});

describe('RealtService — scrape', () => {
  let module: TestingModule;
  let service: RealtService;
  let parser: jest.Mocked<RealtParserService>;
  let snapshot: jest.Mocked<SnapshotService>;
  let notifier: jest.Mocked<RealtNotifierService>;
  let config: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    jest.spyOn(RealtService.prototype, 'onModuleInit').mockImplementation(() => {});

    module = await Test.createTestingModule({
      providers: [
        RealtService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              if (key === 'realt.feeds') return [feed1];
              return undefined;
            }),
          },
        },
        {
          provide: SchedulerRegistry,
          useValue: { doesExist: jest.fn().mockReturnValue(false), deleteCronJob: jest.fn() },
        },
        {
          provide: RealtParserService,
          useValue: { fetchFeed: jest.fn() },
        },
        {
          provide: SnapshotService,
          useValue: { read: jest.fn(), write: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: RealtNotifierService,
          useValue: {
            notifyRunResult: jest
              .fn()
              .mockResolvedValue({ notifiedNew: new Map(), notifiedPriceChanges: new Map() }),
            notifyError: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(RealtService);
    parser = module.get(RealtParserService);
    snapshot = module.get(SnapshotService);
    notifier = module.get(RealtNotifierService);
    config = module.get(ConfigService);
  });

  afterEach(async () => {
    await module.close();
  });

  function setupRun(opts: {
    listings?: RealtListing[];
    truncated?: boolean;
    previousEntries?: RealtSnapshotEntry[];
    feeds?: RealtFeedConfig[];
    notifyResult?: RealtNotifyResult;
  }): void {
    const {
      listings = [],
      truncated = false,
      previousEntries = [],
      feeds = [feed1],
      notifyResult,
    } = opts;
    (config.get as jest.Mock).mockImplementation((key: string) => {
      if (key === 'realt.feeds') return feeds;
      return undefined;
    });
    parser.fetchFeed.mockResolvedValue({ listings, truncated });
    (snapshot.read as jest.Mock).mockResolvedValue(previousEntries);
    if (notifyResult) {
      notifier.notifyRunResult.mockResolvedValue(notifyResult);
    }
  }

  describe('no feeds configured', () => {
    it('returns { feeds: [] } and makes no parser or snapshot calls', async () => {
      setupRun({ feeds: [] });

      const result = await service.run();

      expect(result).toEqual({ feeds: [] });
      expect(parser.fetchFeed).not.toHaveBeenCalled();
      expect(snapshot.read).not.toHaveBeenCalled();
    });
  });

  describe('diff logic', () => {
    it('first run: all current listings are new', async () => {
      setupRun({ listings: [listingA, listingB] });

      const result = await service.run();

      expect(result.feeds[0].newListings).toEqual([listingA, listingB]);
      expect(result.feeds[0].priceChanges).toHaveLength(0);
    });

    it('no changes (same adId, same price) → re-seen, no new, no price changes', async () => {
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
      const listingBynOnly: RealtListing = { ...listingB, priceByn: 28000 };
      setupRun({ listings: [listingBynOnly], previousEntries: [snapshotB] });

      const result = await service.run();

      expect(result.feeds[0].priceChanges).toHaveLength(0);
    });
  });

  describe('notification-gated persistence', () => {
    it('new listing notified → persisted in snapshot with firstSeenAt/lastSeenAt', async () => {
      const notifyResult: RealtNotifyResult = {
        notifiedNew: new Map([[feed1.key, new Set([listingA.adId])]]),
        notifiedPriceChanges: new Map(),
      };
      setupRun({ listings: [listingA], notifyResult });

      await service.run();

      const written = (snapshot.write as jest.Mock).mock.calls[0][1] as RealtSnapshotEntry[];
      const entry = written.find(e => e.adId === listingA.adId);
      expect(entry).toBeDefined();
      expect(entry?.firstSeenAt).toBeTruthy();
      expect(entry?.lastSeenAt).toBeTruthy();
    });

    it('new listing NOT notified → NOT added to snapshot', async () => {
      setupRun({ listings: [listingA] });

      await service.run();

      const written = (snapshot.write as jest.Mock).mock.calls[0][1] as RealtSnapshotEntry[];
      expect(written.find(e => e.adId === listingA.adId)).toBeUndefined();
    });

    it('price change notified → snapshot updated with new price', async () => {
      const notifyResult: RealtNotifyResult = {
        notifiedNew: new Map(),
        notifiedPriceChanges: new Map([[feed1.key, new Set([listingBPriceChanged.adId])]]),
      };
      setupRun({ listings: [listingBPriceChanged], previousEntries: [snapshotB], notifyResult });

      await service.run();

      const written = (snapshot.write as jest.Mock).mock.calls[0][1] as RealtSnapshotEntry[];
      const entry = written.find(e => e.adId === listingBPriceChanged.adId);
      expect(entry?.priceByn).toBe(listingBPriceChanged.priceByn);
      expect(entry?.priceUsd).toBe(listingBPriceChanged.priceUsd);
    });

    it('price change NOT notified → snapshot keeps old price, only lastSeenAt updated', async () => {
      setupRun({ listings: [listingBPriceChanged], previousEntries: [snapshotB] });

      await service.run();

      const written = (snapshot.write as jest.Mock).mock.calls[0][1] as RealtSnapshotEntry[];
      const entry = written.find(e => e.adId === snapshotB.adId);
      expect(entry?.priceByn).toBe(snapshotB.priceByn);
      expect(entry?.priceUsd).toBe(snapshotB.priceUsd);
      expect(entry?.lastSeenAt).not.toBe(snapshotB.lastSeenAt);
    });

    it('re-seen listing (same price) → always updates lastSeenAt', async () => {
      setupRun({ listings: [listingA], previousEntries: [snapshotA] });

      await service.run();

      const written = (snapshot.write as jest.Mock).mock.calls[0][1] as RealtSnapshotEntry[];
      const entry = written.find(e => e.adId === snapshotA.adId);
      expect(entry?.lastSeenAt).not.toBe(snapshotA.lastSeenAt);
    });
  });

  describe('run guard', () => {
    it('throws ConflictException when already running', async () => {
      let unblock!: (value: { listings: RealtListing[]; truncated: boolean }) => void;
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
        if (key === 'realt.feeds') return [feed1, feed2];
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
