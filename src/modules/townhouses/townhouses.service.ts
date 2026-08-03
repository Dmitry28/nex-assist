import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SnapshotService } from '../../common/snapshot.service';
import { TOWNHOUSE_KEYWORDS, matchesKeywords } from '../../common/utils/keyword-filter';
import { pruneStale, STALE_AFTER_DAYS } from '../../common/utils/prune-stale';
import { hasPriceChanged } from '../../common/utils/price-change';
import { sleep } from '../../common/utils/sleep';
import type { TownhouseComplexConfig } from '../../config/townhouses.config';
import { KufarParserService } from '../kufar/kufar-parser.service';
import { RealtParserService } from '../realt/realt-parser.service';
import { DATA_FILE, INTER_SOURCE_DELAY_MS, RUN_TIMEOUT_MS } from './constants';
import {
  isTownhouseSnapshotEntry,
  type TownhouseListing,
  type TownhousePriceChange,
  type TownhouseSnapshotEntry,
  type TownhouseSource,
  type TownhouseSourceResult,
  type TownhousesResult,
} from './dto/townhouse-listing.dto';
import { TownhousesNotifierService } from './townhouses-notifier.service';
import { TownhousesPrometrParserService } from './townhouses-prometr-parser.service';

/**
 * Every townhouse in Grodno, in one place.
 *
 * No site has a single view of them, so four sources are fused:
 *   1. prometr.by  — the primary market, all three developments (Погораны, Белые Росы, Роял Парк)
 *   2. kufar       — dedicated `kupit/dom/taunhaus` sub-category
 *   3. realt       — dedicated `sale/cottages/taunhaus` sub-category
 *   4. kufar/realt flats — townhouses filed as "квартира в блокированном доме", which the
 *      sub-categories above miss; the flats category is watched behind a keyword filter
 *
 * Results land in the pogorany chat, so townhouses stay one topic for the owner.
 *
 * A source that fails is reported rather than treated as empty — otherwise a dead site would
 * look like every one of its listings had vanished.
 */
@Injectable()
export class TownhousesService {
  private readonly logger = new Logger(TownhousesService.name);
  private isRunning = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prometr: TownhousesPrometrParserService,
    private readonly kufar: KufarParserService,
    private readonly realt: RealtParserService,
    private readonly snapshot: SnapshotService,
    private readonly notifier: TownhousesNotifierService,
  ) {}

  async run(): Promise<TownhousesResult> {
    if (this.isRunning) throw new ConflictException('Scrape already in progress');
    this.isRunning = true;

    const watchdog = setTimeout(() => {
      this.logger.error(`Scrape watchdog fired after ${RUN_TIMEOUT_MS / 1000}s — resetting lock`);
      this.isRunning = false;
    }, RUN_TIMEOUT_MS);

    try {
      return await this.scrape();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Critical scrape failure', error);
      try {
        await this.notifier.notifyError(message);
      } catch {
        this.logger.warn('Failed to send error notification to Telegram');
      }
      throw error;
    } finally {
      clearTimeout(watchdog);
      this.isRunning = false;
    }
  }

  private async scrape(): Promise<TownhousesResult> {
    const sources: TownhouseSourceResult[] = [];
    const current: TownhouseListing[] = [];

    for (const [i, collect] of this.collectors().entries()) {
      if (i > 0) await sleep(INTER_SOURCE_DELAY_MS);
      const { source, listings, failed } = await collect();
      sources.push({ source, total: listings.length, failed });
      current.push(...listings);
    }

    // The same townhouse is often listed on both kufar and realt. De-duplication decides what
    // gets *messaged*, never what gets stored: the snapshot keeps every uid the sources
    // returned. Storing only the survivors would be unstable, because the key depends on a
    // price the sites recompute — realt quotes USD as a live conversion, so a listing can move
    // 185014 -> 185491 untouched. The losing twin would then differ run to run, and anything
    // dropped would never persist, resurfacing as "new" the next day, forever.
    const listings = current;
    const keptUids = new Set(dedupe(current).map(l => l.uid));
    const duplicateUids = new Set(current.filter(l => !keptUids.has(l.uid)).map(l => l.uid));

    const previous = await this.snapshot.read(DATA_FILE, isTownhouseSnapshotEntry);
    const previousMap = new Map(previous.map(e => [e.uid, e]));
    const isBaseline = previousMap.size === 0 && listings.length > 0;

    const newListings: TownhouseListing[] = [];
    const priceChanges: TownhousePriceChange[] = [];
    for (const listing of listings) {
      const prev = previousMap.get(listing.uid);
      if (!prev) newListings.push(listing);
      else if (hasPriceChanged(prev, listing))
        priceChanges.push({ listing, oldPriceByn: prev.priceByn, oldPriceUsd: prev.priceUsd });
    }

    // Only the surviving twin is announced; the other is stored silently.
    const result: TownhousesResult = {
      total: previousMap.size + newListings.length,
      newListings: newListings.filter(l => keptUids.has(l.uid)),
      priceChanges: priceChanges.filter(c => keptUids.has(c.listing.uid)),
      sources,
      isBaseline,
    };

    this.logger.log(
      `Collected ${listings.length} townhouse(s), ${duplicateUids.size} cross-listed — ` +
        `new: ${result.newListings.length}, price changes: ${result.priceChanges.length}` +
        `${isBaseline ? ' [BASELINE]' : ''}`,
    );

    const notified = await this.notifier.notifyRunResult(result);
    await this.persist(listings, previousMap, result, notified, duplicateUids);
    return result;
  }

  /** One closure per source, each isolating its own failure. */
  private collectors(): Array<
    () => Promise<{ source: string; listings: TownhouseListing[]; failed: boolean }>
  > {
    const complexes = this.config.get<TownhouseComplexConfig[]>('townhouses.complexes') ?? [];
    const url = (key: string): string => this.config.get<string>(`townhouses.${key}`) ?? '';

    return [
      () =>
        this.guard('prometr', async () => {
          const all: TownhouseListing[] = [];
          let degraded = false;
          for (const c of complexes) {
            const r = await this.prometr.fetchComplex(c.url, c.name);
            all.push(...r.listings);
            degraded ||= r.degraded;
          }
          return { listings: all, degraded };
        }),
      () =>
        this.guard('kufar', async () => {
          const r = await this.kufar.fetchFeed(url('kufarUrl'));
          return { listings: fromKufar(r.listings), degraded: r.truncated };
        }),
      () =>
        this.guard('realt', async () => {
          const r = await this.realt.fetchFeed(url('realtUrl'), 'sale-cottages');
          return { listings: fromRealt(r.listings), degraded: r.truncated };
        }),
      () =>
        this.guard('kufar-flats', async () => {
          const r = await this.kufar.fetchFeed(url('kufarFlatsUrl'));
          return { listings: fromKufar(r.listings).filter(keepTown), degraded: r.truncated };
        }),
      () =>
        this.guard('realt-flats', async () => {
          const r = await this.realt.fetchFeed(url('realtFlatsUrl'), 'sale-flats');
          return { listings: fromRealt(r.listings).filter(keepTown), degraded: r.truncated };
        }),
    ];
  }

  /**
   * Runs one source. `failed` covers both a thrown error and a degraded fetch — the parsers
   * swallow HTTP errors and return an empty list, so without the degraded signal a dead site
   * would be indistinguishable from one with nothing on it.
   */
  private async guard(
    source: string,
    fetchAll: () => Promise<{ listings: TownhouseListing[]; degraded: boolean }>,
  ): Promise<{ source: string; listings: TownhouseListing[]; failed: boolean }> {
    try {
      const { listings, degraded } = await fetchAll();
      this.logger.log(
        `Source ${source}: ${listings.length} listing(s)${degraded ? ' [DEGRADED]' : ''}`,
      );
      return { source, listings, failed: degraded };
    } catch (error) {
      // Swallowed on purpose: one dead source must not abort the others, and reporting it as
      // `failed` keeps the diff from reading its absence as listings being withdrawn.
      this.logger.error(`Source ${source} failed`, error);
      return { source, listings: [], failed: true };
    }
  }

  private async persist(
    listings: TownhouseListing[],
    previousMap: Map<string, TownhouseSnapshotEntry>,
    result: TownhousesResult,
    notified: Set<string>,
    duplicateUids: Set<string>,
  ): Promise<void> {
    // A cross-listed twin is deliberately never messaged, so gating its persistence on
    // delivery would keep it out of the snapshot forever and re-detect it every run.
    const shouldPersist = (uid: string): boolean => notified.has(uid) || duplicateUids.has(uid);
    const now = new Date().toISOString();
    const updated = new Map(previousMap);

    if (result.isBaseline) {
      for (const l of listings) updated.set(l.uid, { ...l, firstSeenAt: now, lastSeenAt: now });
      await this.snapshot.write(DATA_FILE, [...updated.values()]);
      this.logger.log(`Baseline saved (${updated.size} entries, no per-listing messages sent)`);
      return;
    }

    for (const listing of listings) {
      const prev = updated.get(listing.uid);
      if (!prev) {
        // Notify-then-persist: an undelivered listing stays "new" and is retried next run.
        if (shouldPersist(listing.uid))
          updated.set(listing.uid, { ...listing, firstSeenAt: now, lastSeenAt: now });
      } else if (hasPriceChanged(prev, listing)) {
        if (shouldPersist(listing.uid))
          updated.set(listing.uid, { ...listing, firstSeenAt: prev.firstSeenAt, lastSeenAt: now });
        else updated.set(listing.uid, { ...prev, lastSeenAt: now });
      } else {
        // Re-seen at the same price: refresh the whole record rather than only the timestamp.
        // Keeping `...prev` would freeze title, address and photos at whatever the first run
        // captured, so a corrected mapping or an edited ad would never reach the snapshot.
        // `prev` is spread first so any snapshot-only field survives the refresh.
        updated.set(listing.uid, {
          ...prev,
          ...listing,
          firstSeenAt: prev.firstSeenAt,
          lastSeenAt: now,
        });
      }
    }

    // Drop long-gone listings. Skipped when any source failed: their listings are absent for
    // that reason, not because they were withdrawn.
    const anyFailed = result.sources.some(s => s.failed);
    const { kept, removed } = anyFailed
      ? { kept: [...updated.values()], removed: [] }
      : pruneStale([...updated.values()], new Date());
    if (removed.length > 0) {
      this.logger.log(
        `Pruned ${removed.length} listing(s) unseen for over ${STALE_AFTER_DAYS} days`,
      );
    }

    await this.snapshot.write(DATA_FILE, kept);
    this.logger.log(`Snapshot saved (${kept.length} entries)`);
  }
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

const keepTown = (l: TownhouseListing): boolean =>
  matchesKeywords([l.title, l.description ?? '', l.address ?? ''].join(' '), TOWNHOUSE_KEYWORDS);

/**
 * Same property on two sites → one entry. Prefers whichever source was collected first.
 *
 * Matching is deliberately restricted to *different* sources. Price plus area is a decent
 * cross-site fingerprint but not a unique key — within one feed, unrelated units routinely
 * share both (identical layouts in the same development), and collapsing those would silently
 * hide real listings.
 */
export const dedupe = (listings: TownhouseListing[]): TownhouseListing[] => {
  const byUid = new Map<string, TownhouseListing>();
  const seenBySource = new Map<string, TownhouseSource>();
  for (const l of listings) {
    if (byUid.has(l.uid)) continue;
    // Bucket the price: the sites recompute USD from BYN, so the same unit differs by a few
    // hundred between fetches. Same area to 0.1 m² and price within ~1k is one property.
    const key =
      l.priceUsd && l.area ? `${Math.round(l.priceUsd / 1000)}|${l.area.toFixed(1)}` : null;
    if (key !== null) {
      const owner = seenBySource.get(key);
      if (owner !== undefined && owner !== l.source) continue;
      if (owner === undefined) seenBySource.set(key, l.source);
    }
    byUid.set(l.uid, l);
  }
  return [...byUid.values()];
};

export const fromKufar = (
  listings: Array<{
    adId: number;
    link: string;
    title: string;
    priceByn?: number;
    priceUsd?: number;
    area?: number;
    plotArea?: number;
    rooms?: number;
    address?: string;
    images: string[];
  }>,
): TownhouseListing[] =>
  listings.map(l => ({
    uid: `kufar:${l.adId}`,
    source: 'kufar' as const,
    link: l.link,
    title: l.title,
    priceByn: l.priceByn,
    priceUsd: l.priceUsd,
    area: l.area,
    plotArea: l.plotArea,
    rooms: l.rooms,
    address: l.address,
    images: l.images,
  }));

export const fromRealt = (
  listings: Array<{
    adId: number;
    link: string;
    title: string;
    description?: string;
    address?: string;
    priceByn?: number;
    priceUsd?: number;
    area?: number;
    plotArea?: number;
    rooms?: number;
    images: string[];
  }>,
): TownhouseListing[] =>
  listings.map(l => ({
    uid: `realt:${l.adId}`,
    source: 'realt' as const,
    link: l.link,
    title: l.title,
    priceByn: l.priceByn,
    priceUsd: l.priceUsd,
    area: l.area,
    plotArea: l.plotArea,
    rooms: l.rooms,
    address: l.address,
    description: l.description,
    images: l.images,
  }));
