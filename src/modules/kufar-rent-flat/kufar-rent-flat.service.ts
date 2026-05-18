import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SnapshotService } from '../../common/snapshot.service';
import { DATA_FILE, RUN_TIMEOUT_MS } from './constants';
import {
  isKufarRentFlatSnapshotEntry,
  type KufarRentFlatListing,
  type KufarRentFlatResult,
  type KufarRentFlatSnapshotEntry,
} from './dto/kufar-rent-flat-listing.dto';
import {
  KufarRentFlatNotifierService,
  type KufarRentFlatNotifyResult,
} from './kufar-rent-flat-notifier.service';
import { KufarRentFlatParserService } from './kufar-rent-flat-parser.service';

/**
 * Orchestrates the travel.kufar.by short-term rental scrape cycle:
 *   1. Compute check-in / check-out (today + 14d, shifted to weekday).
 *   2. Fetch the current listing set for that 1-night stay.
 *   3. Diff against snapshot by `adId` → only NEW listings (no price tracking, no removals —
 *      the dataset is too small and stay-date-dependent for either signal to be reliable).
 *   4. Send Telegram notifications — only what was successfully sent gets persisted.
 *   5. Persist updated snapshot to disk.
 */
@Injectable()
export class KufarRentFlatService {
  private readonly logger = new Logger(KufarRentFlatService.name);
  private isRunning = false;

  constructor(
    private readonly config: ConfigService,
    private readonly parser: KufarRentFlatParserService,
    private readonly snapshot: SnapshotService,
    private readonly notifier: KufarRentFlatNotifierService,
  ) {}

  async run(): Promise<KufarRentFlatResult> {
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

  private async scrape(): Promise<KufarRentFlatResult> {
    const searchUrl = this.config.getOrThrow<string>('kufarRentFlat.url');

    this.logger.log(`Fetching ${searchUrl}`);

    const [currentListings, previousEntries] = await Promise.all([
      this.parser.fetchListings(searchUrl),
      this.snapshot.read(DATA_FILE, isKufarRentFlatSnapshotEntry),
    ]);

    if (currentListings.length === 0) {
      // Defensive: never wipe a non-empty snapshot if the parser yields nothing.
      // For a narrow bbox an empty result is the normal steady state — treat it as a no-op
      // rather than "all listings removed".
      this.logger.warn('Parser returned 0 listings — skipping diff and persistence');
      return {
        total: previousEntries.length,
        newListings: [],
        isBaseline: false,
      };
    }

    const previousMap = new Map(previousEntries.map(e => [e.adId, e]));
    const isBaseline = previousMap.size === 0;

    const newListings: KufarRentFlatListing[] = [];
    for (const listing of currentListings) {
      if (!previousMap.has(listing.adId)) newListings.push(listing);
    }

    const result: KufarRentFlatResult = {
      total: currentListings.length,
      newListings,
      isBaseline,
    };

    this.logger.log(
      `Diff — total: ${result.total}, new: ${newListings.length}${isBaseline ? ' [BASELINE]' : ''}`,
    );

    const notifyResult = await this.notifier.notifyRunResult(result);
    await this.persistSnapshot(currentListings, previousMap, result, notifyResult);

    return result;
  }

  private async persistSnapshot(
    currentListings: KufarRentFlatListing[],
    previousMap: Map<number, KufarRentFlatSnapshotEntry>,
    result: KufarRentFlatResult,
    notifyResult: KufarRentFlatNotifyResult,
  ): Promise<void> {
    const now = new Date().toISOString();
    const updatedMap = new Map(previousMap);

    if (result.isBaseline) {
      for (const listing of currentListings) {
        updatedMap.set(listing.adId, { ...listing, firstSeenAt: now, lastSeenAt: now });
      }
      await this.snapshot.write(DATA_FILE, [...updatedMap.values()]);
      this.logger.log(`Baseline saved (${updatedMap.size} entries, no per-listing messages sent)`);
      return;
    }

    for (const listing of currentListings) {
      const prev = updatedMap.get(listing.adId);
      if (!prev) {
        // Only persist new listings whose notification was delivered — otherwise retry next run
        if (notifyResult.notifiedNew.has(listing.adId)) {
          updatedMap.set(listing.adId, { ...listing, firstSeenAt: now, lastSeenAt: now });
        }
      } else {
        // Already seen — refresh lastSeenAt and update mutable fields (price, rating, ...)
        // so the snapshot reflects the latest known state without re-notifying.
        updatedMap.set(listing.adId, {
          ...listing,
          firstSeenAt: prev.firstSeenAt,
          lastSeenAt: now,
        });
      }
    }

    const pendingCount = result.newListings.filter(
      l => !notifyResult.notifiedNew.has(l.adId),
    ).length;
    if (pendingCount > 0) {
      this.logger.warn(
        `${pendingCount} listing(s) not persisted — notification failed, will retry next run`,
      );
    }

    await this.snapshot.write(DATA_FILE, [...updatedMap.values()]);
    this.logger.log(`Snapshot saved (${updatedMap.size} entries)`);
  }
}
