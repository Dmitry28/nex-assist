import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { SnapshotService } from '../../common/snapshot.service';
import { DATA_FILE, RUN_TIMEOUT_MS } from './constants';
import {
  isPogoranySnapshotEntry,
  type PogoranyListing,
  type PogoranyPriceChange,
  type PogoranyResult,
  type PogoranySnapshotEntry,
} from './dto/pogorany-listing.dto';
import { PogoranyNotifierService, type PogoranyNotifyResult } from './pogorany-notifier.service';
import { PogoranyParserService } from './pogorany-parser.service';

/**
 * Treat 0 / undefined / empty currency as equivalent "no price" to avoid false
 * change detections when the seller temporarily hides a price.
 */
const effectivePrice = (
  value: number | undefined,
  currency: string | undefined,
): { value: number; currency: string } | undefined =>
  value !== undefined && value > 0 ? { value, currency: currency ?? '' } : undefined;

/**
 * Price changed if value OR currency differs (currency swap is a real price change too —
 * 103 500 USD → 207 000 BYN is not the same lot at the same price).
 */
export const hasPriceChanged = (prev: PogoranySnapshotEntry, current: PogoranyListing): boolean => {
  const a = effectivePrice(prev.price, prev.currency);
  const b = effectivePrice(current.price, current.currency);
  if (a === undefined && b === undefined) return false;
  if (a === undefined || b === undefined) return true;
  return a.value !== b.value || a.currency !== b.currency;
};

/**
 * Orchestrates the pogorany.by scrape cycle:
 *   1. Fetch current catalog from Tilda store + per-product pages.
 *   2. Diff against snapshot → new / removed / price-changed lots.
 *   3. Send Telegram notifications — only what was successfully sent gets persisted.
 *   4. Persist updated snapshot to disk.
 */
@Injectable()
export class PogoranyService {
  private readonly logger = new Logger(PogoranyService.name);
  private isRunning = false;

  constructor(
    private readonly parser: PogoranyParserService,
    private readonly snapshot: SnapshotService,
    private readonly notifier: PogoranyNotifierService,
  ) {}

  async run(): Promise<PogoranyResult> {
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

  private async scrape(): Promise<PogoranyResult> {
    const [currentListings, previousEntries] = await Promise.all([
      this.parser.fetch(),
      this.snapshot.read(DATA_FILE, isPogoranySnapshotEntry),
    ]);

    if (currentListings.length === 0) {
      // Defensive: never wipe a non-empty snapshot if the parser yields nothing.
      // A site outage shouldn't masquerade as "all lots removed".
      this.logger.warn('Parser returned 0 listings — skipping diff and persistence');
      return {
        total: previousEntries.length,
        newListings: [],
        removedListings: [],
        priceChanges: [],
        isBaseline: false,
      };
    }

    const previousMap = new Map(previousEntries.map(e => [e.uid, e]));
    const currentMap = new Map(currentListings.map(l => [l.uid, l]));
    const isBaseline = previousMap.size === 0;

    const newListings: PogoranyListing[] = [];
    const priceChanges: PogoranyPriceChange[] = [];
    for (const listing of currentListings) {
      const prev = previousMap.get(listing.uid);
      if (!prev) {
        newListings.push(listing);
      } else if (hasPriceChanged(prev, listing)) {
        priceChanges.push({ listing, oldPrice: prev.price, oldCurrency: prev.currency });
      }
    }

    const removedListings: PogoranyListing[] = [];
    for (const prev of previousEntries) {
      if (!currentMap.has(prev.uid)) removedListings.push(prev);
    }

    const result: PogoranyResult = {
      total: currentListings.length,
      newListings,
      removedListings,
      priceChanges,
      isBaseline,
    };

    this.logger.log(
      `Diff — total: ${result.total}, new: ${newListings.length}, removed: ${removedListings.length}, price changes: ${priceChanges.length}${isBaseline ? ' [BASELINE]' : ''}`,
    );

    const notifyResult = await this.notifier.notifyRunResult(result);
    await this.persistSnapshot(currentListings, previousMap, result, notifyResult);

    return result;
  }

  private async persistSnapshot(
    currentListings: PogoranyListing[],
    previousMap: Map<number, PogoranySnapshotEntry>,
    result: PogoranyResult,
    notifyResult: PogoranyNotifyResult,
  ): Promise<void> {
    const now = new Date().toISOString();
    const updatedMap = new Map(previousMap);

    if (result.isBaseline) {
      for (const listing of currentListings) {
        updatedMap.set(listing.uid, { ...listing, firstSeenAt: now, lastSeenAt: now });
      }
      await this.snapshot.write(DATA_FILE, [...updatedMap.values()]);
      this.logger.log(`Baseline saved (${updatedMap.size} entries, no per-listing messages sent)`);
      return;
    }

    for (const listing of currentListings) {
      const prev = updatedMap.get(listing.uid);
      const isNew = !prev;
      const isPriceChange = prev !== undefined && hasPriceChanged(prev, listing);

      if (isNew) {
        if (notifyResult.notifiedNew.has(listing.uid)) {
          updatedMap.set(listing.uid, { ...listing, firstSeenAt: now, lastSeenAt: now });
        }
      } else if (isPriceChange) {
        if (notifyResult.notifiedPriceChanges.has(listing.uid)) {
          updatedMap.set(listing.uid, {
            ...listing,
            firstSeenAt: prev.firstSeenAt,
            lastSeenAt: now,
          });
        } else {
          updatedMap.set(listing.uid, { ...prev, lastSeenAt: now });
        }
      } else {
        updatedMap.set(listing.uid, { ...prev, lastSeenAt: now });
      }
    }

    for (const removed of result.removedListings) {
      if (notifyResult.notifiedRemoved.has(removed.uid)) {
        updatedMap.delete(removed.uid);
      }
    }

    const pendingCount =
      result.newListings.filter(l => !notifyResult.notifiedNew.has(l.uid)).length +
      result.priceChanges.filter(c => !notifyResult.notifiedPriceChanges.has(c.listing.uid))
        .length +
      result.removedListings.filter(l => !notifyResult.notifiedRemoved.has(l.uid)).length;
    if (pendingCount > 0) {
      this.logger.warn(
        `${pendingCount} change(s) not persisted — notification failed, will retry next run`,
      );
    }

    await this.snapshot.write(DATA_FILE, [...updatedMap.values()]);
    this.logger.log(`Snapshot saved (${updatedMap.size} entries)`);
  }
}
