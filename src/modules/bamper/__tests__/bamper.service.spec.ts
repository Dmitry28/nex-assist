import type { ConfigService } from '@nestjs/config';
import type { SnapshotService } from '../../../common/snapshot.service';
import type { SourceHealthService } from '../../../common/source-health.service';
import type { BamperFeedConfig } from '../../../config/bamper.config';
import type { BamperNotifierService } from '../bamper-notifier.service';
import type { BamperParserService } from '../bamper-parser.service';
import { BamperService } from '../bamper.service';
import type { BamperListing, BamperResult } from '../dto/bamper-listing.dto';

// The inter-feed pause is real seconds in production and nothing to wait for in a test.
jest.mock('../../../common/utils/sleep', () => ({ sleep: (): Promise<void> => Promise.resolve() }));

const feed = (key: string): BamperFeedConfig => ({
  key,
  car: 'VW Atlas',
  label: key,
  url: `https://bamper.by/zchbu/zapchast_${key}/marka_volkswagen/`,
});

const listing = (id: string): BamperListing => ({
  id,
  url: `https://bamper.by/${id}`,
  title: `part ${id}`,
});

interface Harness {
  service: BamperService;
  written: Map<string, unknown[]>;
  notified: BamperResult[];
  errors: string[];
  healthAlerts: string[];
  fetched: string[];
}

/**
 * Wires the service to stubs whose only interesting behaviour is which feeds fail to fetch and,
 * when `healthAlert` is given, what the source-health watchdog has to say about every feed.
 */
const harness = (
  feeds: BamperFeedConfig[],
  failing: Set<string>,
  healthAlert: string | null = null,
): Harness => {
  const written = new Map<string, unknown[]>();
  const notified: BamperResult[] = [];
  const errors: string[] = [];
  const healthAlerts: string[] = [];
  const fetched: string[] = [];

  const config = { get: () => feeds } as unknown as ConfigService;

  const parser = {
    fetch: (url: string): Promise<BamperListing[]> => {
      const key = url.match(/zapchast_([^/]+)/)?.[1] ?? '';
      fetched.push(key);
      if (failing.has(key)) return Promise.reject(new Error(`${key} is behind Cloudflare`));
      return Promise.resolve([listing(`${key}-1`)]);
    },
  } as unknown as BamperParserService;

  const snapshot = {
    read: (): Promise<unknown[]> => Promise.resolve([]),
    write: (file: string, entries: unknown[]): Promise<void> => {
      written.set(file, entries);
      return Promise.resolve();
    },
  } as unknown as SnapshotService;

  const notifier = {
    notifyRunResult: (result: BamperResult) => {
      notified.push(result);
      return Promise.resolve({
        notifiedNew: new Set(result.feeds.flatMap(f => f.newListings.map(l => l.id))),
      });
    },
    notifyError: (message: string): Promise<void> => {
      errors.push(message);
      return Promise.resolve();
    },
    notifyHealth: (message: string): Promise<void> => {
      healthAlerts.push(message);
      return Promise.resolve();
    },
  } as unknown as BamperNotifierService;

  // Health tracking is exercised in its own spec; here it stays quiet unless a test asks for it.
  const health = {
    record: () => Promise.resolve({ alert: healthAlert, zeroRuns: 0 }),
  } as unknown as SourceHealthService;

  return {
    service: new BamperService(config, parser, snapshot, notifier, health),
    written,
    notified,
    errors,
    healthAlerts,
    fetched,
  };
};

describe('BamperService', () => {
  const originalAppEnv = process.env.APP_ENV;
  beforeEach(() => {
    process.env.APP_ENV = 'production';
  });
  afterAll(() => {
    if (originalAppEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = originalAppEnv;
  });

  it('skips outside production, so dev does not spend the shared provider credits', async () => {
    process.env.APP_ENV = 'development';
    const { service, notified, written } = harness([feed('kapot')], new Set());
    const result = await service.run();

    expect(result).toEqual({ feeds: [], failedFeeds: [] });
    expect(notified).toHaveLength(0);
    expect(written.size).toBe(0);
  });

  // The bug this covers cost three days of parts monitoring: the first feed's fetch threw out of
  // the loop, so the other five parts were never checked and nothing said so.
  describe('when one feed fails to fetch', () => {
    const feeds = [feed('bamper-zadniy'), feed('kapot'), feed('fara-levaya')];

    it('still checks the remaining feeds', async () => {
      const { service } = harness(feeds, new Set(['bamper-zadniy']));
      const result = await service.run();

      expect(result.feeds.map(f => f.feedKey)).toEqual(['kapot', 'fara-levaya']);
    });

    it('names the failed feed in the result, so the summary can warn about it', async () => {
      const { service, notified } = harness(feeds, new Set(['bamper-zadniy']));
      const result = await service.run();

      expect(result.failedFeeds).toEqual(['VW Atlas · bamper-zadniy']);
      expect(notified[0].failedFeeds).toEqual(['VW Atlas · bamper-zadniy']);
    });

    it('persists the feeds that did work and leaves the failed one untouched', async () => {
      const { service, written } = harness(feeds, new Set(['bamper-zadniy']));
      await service.run();

      expect([...written.keys()]).toEqual([
        './data/bamper_kapot_all.json',
        './data/bamper_fara-levaya_all.json',
      ]);
    });

    it('does not raise the outage alert for a partial run', async () => {
      const { service, errors } = harness(feeds, new Set(['bamper-zadniy']));
      await service.run();

      expect(errors).toEqual([]);
    });
  });

  // Every feed failing is a real outage — Cloudflare, or the whole provider chain spent — and
  // that still has to reach Telegram rather than pass as a quiet run.
  it('fails the run and alerts when every feed fails', async () => {
    const feeds = [feed('bamper-zadniy'), feed('kapot')];
    const { service, errors, notified } = harness(feeds, new Set(['bamper-zadniy', 'kapot']));

    await expect(service.run()).rejects.toThrow('kapot is behind Cloudflare');
    expect(errors).toEqual(['kapot is behind Cloudflare']);
    expect(notified).toEqual([]);
  });

  // On 28.11 every one of 12 feeds failed on the same cause and the run spent 42 minutes (~3.5 min
  // per feed) finding that out. Once the failures are clearly shared, the rest are not tried.
  it('stops fetching after 3 feeds fail in a row and names the skipped ones as failed', async () => {
    const feeds = ['a', 'b', 'c', 'd', 'e', 'f'].map(feed);
    const { service, fetched } = harness(feeds, new Set(['c', 'd', 'e']));

    const result = await service.run();

    expect(fetched).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(result.feeds.map(f => f.feedKey)).toEqual(['a', 'b']);
    expect(result.failedFeeds).toEqual(['c', 'd', 'e', 'f'].map(k => `VW Atlas · ${k}`));
  });

  it('keeps going when failures are not consecutive', async () => {
    const feeds = ['a', 'b', 'c', 'd', 'e'].map(feed);
    const { service, fetched } = harness(feeds, new Set(['a', 'b', 'd']));

    const result = await service.run();

    expect(fetched).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(result.feeds.map(f => f.feedKey)).toEqual(['c', 'e']);
  });

  // A recovery verdict once arrived in the channel under the "⚠️ Ошибка скрапинга" header,
  // because the health alert went out through notifyError like a real failure would.
  it('sends a source-health verdict as a plain message, not as a scrape error', async () => {
    const alert = '✅ Источник «bamper:kapot» снова отдаёт данные (пустовал 5 прогон(ов) подряд)';
    const { service, errors, healthAlerts } = harness([feed('kapot')], new Set(), alert);

    await service.run();

    expect(healthAlerts).toEqual([alert]);
    expect(errors).toEqual([]);
  });

  it('reports no failures on a clean run', async () => {
    const { service } = harness([feed('kapot')], new Set());
    const result = await service.run();

    expect(result.failedFeeds).toEqual([]);
    expect(result.feeds).toHaveLength(1);
  });
});
