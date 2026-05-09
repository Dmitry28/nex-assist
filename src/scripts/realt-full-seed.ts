/**
 * One-off seeder: fetches every realt.by feed in its entirety (no 48h lookback)
 * and writes the result to the snapshot file as a fresh baseline.
 *
 * Use when adding a new feed or rebuilding from scratch — afterward the regular
 * scheduled run keeps diffing against this complete picture instead of seeing
 * 90-day-old listings as "new" the moment a seller bumps them.
 *
 * Run: `npx ts-node src/scripts/realt-full-seed.ts`
 *
 * Does NOT send Telegram messages. Does NOT call the running app — talks
 * directly to realt.by and writes snapshot files.
 */
import { promises as fs } from 'fs';
import { Logger } from '@nestjs/common';
import {
  mapListing,
  RealtParserService,
  type RawObject,
} from '../modules/realt/realt-parser.service';
import { dataFile, MAX_PAGES } from '../modules/realt/constants';
import type { RealtSnapshotEntry } from '../modules/realt/dto/realt-listing.dto';
import { REALT_DEFAULTS } from '../config/constants';

interface FeedSpec {
  key: string;
  url: string;
  linkPath: string;
}

const FEEDS: FeedSpec[] = [
  { key: 'plots', url: REALT_DEFAULTS.PLOTS_URL, linkPath: 'sale-plots' },
  { key: 'garage', url: REALT_DEFAULTS.GARAGE_URL, linkPath: 'sale-garage' },
  { key: 'dom', url: REALT_DEFAULTS.COTTAGES_URL, linkPath: 'sale-cottages' },
  { key: 'dacha', url: REALT_DEFAULTS.DACHI_URL, linkPath: 'sale-dachi' },
];

const log = new Logger('RealtFullSeed');

async function fetchAllObjects(parser: RealtParserService, feed: FeedSpec): Promise<RawObject[]> {
  const all: RawObject[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const u = new URL(feed.url);
    if (page > 1) u.searchParams.set('page', String(page));
    // Access private methods via index signature — this is a one-off seeder, not production code.
    const svc = parser as unknown as {
      fetchHtml: (url: string) => Promise<string | null>;
      extractPageData: (html: string) => {
        objects: RawObject[];
        pagination: { totalCount: number; pageSize: number } | null;
      };
    };
    const html = await svc.fetchHtml(u.toString());
    if (!html) break;
    const { objects, pagination } = svc.extractPageData(html);
    if (objects.length === 0) break;
    all.push(...objects);
    log.log(
      `${feed.key} page ${page}: ${objects.length} objects (totalCount=${pagination?.totalCount ?? '?'})`,
    );
    if (!pagination || page * pagination.pageSize >= pagination.totalCount) break;
  }
  return all;
}

async function main(): Promise<void> {
  const parser = new RealtParserService();
  const now = new Date().toISOString();

  for (const feed of FEEDS) {
    const objects = await fetchAllObjects(parser, feed);
    const entries: RealtSnapshotEntry[] = objects.map(o => ({
      ...mapListing(o, feed.linkPath),
      firstSeenAt: now,
      lastSeenAt: now,
    }));
    const path = dataFile(feed.key);
    await fs.writeFile(path, JSON.stringify(entries, null, 2));
    log.log(`Wrote ${entries.length} entries → ${path}`);
  }
}

main().catch(err => {
  log.error('Seeder failed', err);
  process.exit(1);
});
