import type { ConfigService } from '@nestjs/config';
import type { SnapshotService } from '../../../common/snapshot.service';
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
}

/** Wires the service to stubs whose only interesting behaviour is which feeds fail to fetch. */
const harness = (feeds: BamperFeedConfig[], failing: Set<string>): Harness => {
  const written = new Map<string, unknown[]>();
  const notified: BamperResult[] = [];
  const errors: string[] = [];

  const config = { get: () => feeds } as unknown as ConfigService;

  const parser = {
    fetch: (url: string): Promise<BamperListing[]> => {
      const key = url.match(/zapchast_([^/]+)/)?.[1] ?? '';
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
  } as unknown as BamperNotifierService;

  return {
    service: new BamperService(config, parser, snapshot, notifier),
    written,
    notified,
    errors,
  };
};

describe('BamperService', () => {
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

      expect(result.failedFeeds).toEqual(['bamper-zadniy']);
      expect(notified[0].failedFeeds).toEqual(['bamper-zadniy']);
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

  it('reports no failures on a clean run', async () => {
    const { service } = harness([feed('kapot')], new Set());
    const result = await service.run();

    expect(result.failedFeeds).toEqual([]);
    expect(result.feeds).toHaveLength(1);
  });
});
