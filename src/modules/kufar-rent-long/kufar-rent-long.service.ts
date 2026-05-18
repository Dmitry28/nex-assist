import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SnapshotService } from '../../common/snapshot.service';
import { DATA_FILE, RUN_TIMEOUT_MS } from './constants';
import {
  isKufarRentLongSnapshotEntry,
  type KufarRentLongListing,
  type KufarRentLongResult,
  type KufarRentLongSnapshotEntry,
} from './dto/kufar-rent-long-listing.dto';
import {
  KufarRentLongNotifierService,
  type KufarRentLongNotifyResult,
} from './kufar-rent-long-notifier.service';
import { KufarRentLongParserService } from './kufar-rent-long-parser.service';

/**
 * Orchestrates the re.kufar.by long-term rental scrape cycle:
 *   1. Fetch the current listing set from the configured search URL.
 *   2. Diff against snapshot by `adId` → only NEW listings (no price tracking, no removals —
 *      the dataset is small and rental ads turn over slowly; price changes on the same lot
 *      are rare enough that we don't bother tracking them here).
 *   3. Send Telegram notifications — only what was successfully sent gets persisted.
 *   4. Persist updated snapshot to disk.
 */
@Injectable()
export class KufarRentLongService {
  private readonly logger = new Logger(KufarRentLongService.name);
  private isRunning = false;

  constructor(
    private readonly config: ConfigService,
    private readonly parser: KufarRentLongParserService,
    private readonly snapshot: SnapshotService,
    private readonly notifier: KufarRentLongNotifierService,
  ) {}

  async run(): Promise<KufarRentLongResult> {
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

  private async scrape(): Promise<KufarRentLongResult> {
    const searchUrl = this.config.getOrThrow<string>('kufarRentLong.url');

    this.logger.log(`Fetching ${searchUrl}`);

    const [currentListings, previousEntries] = await Promise.all([
      this.parser.fetchListings(searchUrl),
      this.snapshot.read(DATA_FILE, isKufarRentLongSnapshotEntry),
    ]);

    if (currentListings.length === 0) {
      // Defensive: never wipe a non-empty snapshot if the parser yields nothing.
      // For a narrow bbox an empty result is the normal steady state — treat it as a no-op
      // rather than "all listings removed".
      this.logger.warn('Parser returned 0 listings — skipping diff and persistence');
      return { total: previousEntries.length, newListings: [], isBaseline: false };
    }

    const previousMap = new Map(previousEntries.map(e => [e.adId, e]));
    const isBaseline = previousMap.size === 0;

    const newListings: KufarRentLongListing[] = [];
    for (const listing of currentListings) {
      if (!previousMap.has(listing.adId)) newListings.push(listing);
    }

    const result: KufarRentLongResult = {
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
    currentListings: KufarRentLongListing[],
    previousMap: Map<number, KufarRentLongSnapshotEntry>,
    result: KufarRentLongResult,
    notifyResult: KufarRentLongNotifyResult,
  ): Promise<void> {
    const now = new Date().toISOString();
    const updatedMap = new Map(previousMap);

    if (result.isBaseline) {
      for (const listing of currentListings) {
        updatedMap.set(listing.adId, { ...listing, firstSeenAt: now, lastSeenAt: now });
      }
      await this.snapshot.write(DATA_FILE, [...updatedMap.values()]);
      this.logger.log(`Baseline saved (${updatedMap.size} entries)`);
      return;
    }

    for (const listing of currentListings) {
      const prev = updatedMap.get(listing.adId);
      if (!prev) {
        if (notifyResult.notifiedNew.has(listing.adId)) {
          updatedMap.set(listing.adId, { ...listing, firstSeenAt: now, lastSeenAt: now });
        }
      } else {
        // Already seen — refresh lastSeenAt and the current mutable fields without re-notifying.
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
