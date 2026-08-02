import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SnapshotService } from '../../common/snapshot.service';
import { TOWNHOUSE_KEYWORDS, matchesKeywords } from '../../common/utils/keyword-filter';
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

    // The same townhouse is often listed on both kufar and realt. Keep the first, so the
    // owner gets one message per property rather than one per site.
    const listings = dedupe(current);

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

    const result: TownhousesResult = {
      total: previousMap.size + newListings.length,
      newListings,
      priceChanges,
      sources,
      isBaseline,
    };

    this.logger.log(
      `Collected ${listings.length} townhouse(s) — new: ${newListings.length}, ` +
        `price changes: ${priceChanges.length}${isBaseline ? ' [BASELINE]' : ''}`,
    );

    const notified = await this.notifier.notifyRunResult(result);
    await this.persist(listings, previousMap, result, notified);
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
          for (const c of complexes) all.push(...(await this.prometr.fetchComplex(c.url, c.name)));
          return all;
        }),
      () =>
        this.guard('kufar', async () =>
          fromKufar((await this.kufar.fetchFeed(url('kufarUrl'))).listings),
        ),
      () =>
        this.guard('realt', async () =>
          fromRealt((await this.realt.fetchFeed(url('realtUrl'), 'sale-cottages')).listings),
        ),
      () =>
        this.guard('kufar-flats', async () =>
          fromKufar((await this.kufar.fetchFeed(url('kufarFlatsUrl'))).listings).filter(keepTown),
        ),
      () =>
        this.guard('realt-flats', async () =>
          fromRealt(
            (await this.realt.fetchFeed(url('realtFlatsUrl'), 'sale-flats')).listings,
          ).filter(keepTown),
        ),
    ];
  }

  private async guard(
    source: string,
    fetchAll: () => Promise<TownhouseListing[]>,
  ): Promise<{ source: string; listings: TownhouseListing[]; failed: boolean }> {
    try {
      const listings = await fetchAll();
      this.logger.log(`Source ${source}: ${listings.length} listing(s)`);
      return { source, listings, failed: false };
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
  ): Promise<void> {
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
        if (notified.has(listing.uid))
          updated.set(listing.uid, { ...listing, firstSeenAt: now, lastSeenAt: now });
      } else if (hasPriceChanged(prev, listing)) {
        if (notified.has(listing.uid))
          updated.set(listing.uid, { ...listing, firstSeenAt: prev.firstSeenAt, lastSeenAt: now });
        else updated.set(listing.uid, { ...prev, lastSeenAt: now });
      } else {
        updated.set(listing.uid, { ...prev, lastSeenAt: now });
      }
    }

    await this.snapshot.write(DATA_FILE, [...updated.values()]);
    this.logger.log(`Snapshot saved (${updated.size} entries)`);
  }
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

const keepTown = (l: TownhouseListing): boolean =>
  matchesKeywords(l.title, TOWNHOUSE_KEYWORDS) ||
  matchesKeywords(l.address ?? '', TOWNHOUSE_KEYWORDS);

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
    const key = l.priceUsd && l.area ? `${l.priceUsd}|${l.area}` : null;
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
    address: l.description,
    images: l.images,
  }));
