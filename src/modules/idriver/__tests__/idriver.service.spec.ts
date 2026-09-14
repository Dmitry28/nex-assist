import type { ConfigService } from '@nestjs/config';
import type { SnapshotService } from '../../../common/snapshot.service';
import type { SourceHealthService } from '../../../common/source-health.service';
import type { IdriverFeedConfig } from '../../../config/idriver.config';
import { RETENTION_DAYS, dataFile } from '../constants';
import type { IdriverNotifierService } from '../idriver-notifier.service';
import type { IdriverParserService } from '../idriver-parser.service';
import { IdriverService } from '../idriver.service';
import type {
  IdriverListing,
  IdriverResult,
  IdriverSnapshotEntry,
} from '../dto/idriver-listing.dto';

jest.mock('../../../common/utils/sleep', () => ({ sleep: (): Promise<void> => Promise.resolve() }));

const MIN_YEAR = 2023;
const FEED: IdriverFeedConfig = {
  key: 'atlas-cross-sport',
  car: 'Atlas Cross Sport',
  url: 'https://idriver.by/auto-parts/volkswagen/atlas-cross-sport?sorter=fresh',
};

const listing = (id: string, year?: number): IdriverListing => ({
  id,
  url: `https://idriver.by/auto-parts/kapot/volkswagen/atlas-cross-sport/${id}`,
  title: `Капот Volkswagen Atlas Cross Sport, ${year ?? '—'}`,
  part: 'Капот',
  ...(year ? { year } : {}),
});

const entry = (id: string, lastSeenAt: string): IdriverSnapshotEntry => ({
  ...listing(id, 2024),
  firstSeenAt: lastSeenAt,
  lastSeenAt,
});

interface Harness {
  service: IdriverService;
  written: Map<string, unknown[]>;
  notified: IdriverResult[];
}

const harness = (current: IdriverListing[], previous: IdriverSnapshotEntry[] = []): Harness => {
  const written = new Map<string, unknown[]>();
  const notified: IdriverResult[] = [];

  const config = {
    get: (key: string): unknown => (key === 'idriver.minYear' ? MIN_YEAR : [FEED]),
  } as unknown as ConfigService;

  const parser = {
    fetch: (): Promise<IdriverListing[]> => Promise.resolve(current),
  } as unknown as IdriverParserService;

  const snapshot = {
    read: (): Promise<IdriverSnapshotEntry[]> => Promise.resolve(previous),
    write: (file: string, entries: unknown[]): Promise<void> => {
      written.set(file, entries);
      return Promise.resolve();
    },
  } as unknown as SnapshotService;

  const notifier = {
    notifyRunResult: (result: IdriverResult) => {
      notified.push(result);
      return Promise.resolve({
        notifiedNew: new Set(result.feeds.flatMap(f => f.newListings.map(l => l.id))),
      });
    },
    notifyError: (): Promise<void> => Promise.resolve(),
  } as unknown as IdriverNotifierService;

  const health = {
    record: () => Promise.resolve({ alert: null, zeroRuns: 0 }),
  } as unknown as SourceHealthService;

  return {
    service: new IdriverService(config, parser, snapshot, notifier, health),
    written,
    notified,
  };
};

describe('IdriverService', () => {
  // The site has no year filter in its URLs, so this cut is the whole point of the module:
  // without it the channel would fill with 2019-2022 donors that do not fit the car.
  describe('year filter', () => {
    it('notifies only listings from the configured year onwards', async () => {
      const { service } = harness([listing('1', 2020), listing('2', 2024)]);
      const result = await service.run();

      expect(result.feeds[0].total).toBe(2);
      expect(result.feeds[0].matching).toBe(1);
      expect(result.feeds[0].newListings.map(l => l.id)).toEqual(['2']);
    });

    it('keeps listings whose year the site did not state', async () => {
      const { service } = harness([listing('1'), listing('2', 2019)]);
      const result = await service.run();

      expect(result.feeds[0].newListings.map(l => l.id)).toEqual(['1']);
    });
  });

  describe('snapshot', () => {
    it('persists only listings that were delivered, and only matching ones', async () => {
      const { service, written } = harness([listing('1', 2020), listing('2', 2024)]);
      await service.run();

      const saved = written.get(dataFile(FEED.key)) as IdriverSnapshotEntry[];
      expect(saved.map(e => e.id)).toEqual(['2']);
    });

    // A run sees only the newest page, so absence never means sold — entries must age out
    // instead, or every listing pushed off page one would be re-notified tomorrow.
    it('keeps an entry that is absent from this page and drops it only once it is stale', async () => {
      const fresh = entry('old-fresh', new Date().toISOString());
      const stale = entry(
        'old-stale',
        new Date(Date.now() - (RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString(),
      );
      const { service, written } = harness([listing('2', 2024)], [fresh, stale]);
      await service.run();

      const saved = written.get(dataFile(FEED.key)) as IdriverSnapshotEntry[];
      expect(saved.map(e => e.id).sort()).toEqual(['2', 'old-fresh']);
    });

    it('does not re-notify a listing already in the snapshot', async () => {
      const known = entry('2', new Date().toISOString());
      const { service } = harness([listing('2', 2024)], [known]);
      const result = await service.run();

      expect(result.feeds[0].newListings).toEqual([]);
      expect(result.feeds[0].isBaseline).toBe(false);
    });
  });

  // A page that parses to nothing is a broken source, not a quiet day — the summary has to keep
  // showing the car, and the snapshot must survive untouched.
  describe('when the page parses to nothing', () => {
    it('still reports the car, with zeroes, and writes no snapshot', async () => {
      const known = entry('2', new Date().toISOString());
      const { service, written } = harness([], [known]);
      const result = await service.run();

      expect(result.feeds).toHaveLength(1);
      expect(result.feeds[0]).toMatchObject({ car: FEED.car, total: 0, matching: 0 });
      expect(result.feeds[0].newListings).toEqual([]);
      expect(written.size).toBe(0);
    });
  });

  // Page one turning over completely means arrivals may have scrolled past between runs; the
  // run has to say so rather than report a clean sweep.
  describe('coverage', () => {
    it('flags a page on which nothing was seen before', async () => {
      const known = entry('old', new Date().toISOString());
      const { service } = harness([listing('2', 2024)], [known]);
      const result = await service.run();

      expect(result.feeds[0].mayHaveMissed).toBe(true);
    });

    it('does not flag a page that still overlaps the snapshot', async () => {
      const known = entry('2', new Date().toISOString());
      const { service } = harness([listing('2', 2024), listing('3', 2024)], [known]);
      const result = await service.run();

      expect(result.feeds[0].mayHaveMissed).toBe(false);
    });
  });
});
