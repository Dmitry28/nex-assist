import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { SnapshotService } from '../../common/snapshot.service';
import { DATA_FILE, RUN_TIMEOUT_MS } from './constants';
import {
  isGhbSnapshotEntry,
  type GhbListing,
  type GhbResult,
  type GhbSnapshotEntry,
} from './dto/ghb-listing.dto';
import { GhbNotifierService, type GhbNotifyResult } from './ghb-notifier.service';
import { GhbParserService } from './ghb-parser.service';

/**
 * Orchestrates the ghb.by price-list scrape cycle:
 *   1. Fetch the price list HTML and parse items.
 *   2. Diff against snapshot — report only **new** items (no removed / price-change).
 *   3. Send Telegram notifications; only delivered items are persisted.
 *
 * The price list is small and rarely changes — we run once a day via the scrape script.
 * Defensive: if the parser returns 0 items but the snapshot has entries, skip persistence
 * (site outage or layout change shouldn't wipe history).
 */
@Injectable()
export class GhbService {
  private readonly logger = new Logger(GhbService.name);
  private isRunning = false;

  constructor(
    private readonly parser: GhbParserService,
    private readonly snapshot: SnapshotService,
    private readonly notifier: GhbNotifierService,
  ) {}

  async run(): Promise<GhbResult> {
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

  private async scrape(): Promise<GhbResult> {
    const [currentListings, previousEntries] = await Promise.all([
      this.parser.fetch(),
      this.snapshot.read(DATA_FILE, isGhbSnapshotEntry),
    ]);

    if (currentListings.length === 0) {
      this.logger.warn('Parser returned 0 listings — skipping diff and persistence');
      return {
        total: previousEntries.length,
        newListings: [],
        isBaseline: false,
      };
    }

    const previousMap = new Map(previousEntries.map(e => [e.url, e]));
    const isBaseline = previousMap.size === 0;

    const newListings: GhbListing[] = [];
    for (const listing of currentListings) {
      if (!previousMap.has(listing.url)) newListings.push(listing);
    }

    const result: GhbResult = {
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
    currentListings: GhbListing[],
    previousMap: Map<string, GhbSnapshotEntry>,
    result: GhbResult,
    notifyResult: GhbNotifyResult,
  ): Promise<void> {
    const now = new Date().toISOString();
    const updatedMap = new Map(previousMap);

    if (result.isBaseline) {
      for (const listing of currentListings) {
        updatedMap.set(listing.url, { ...listing, firstSeenAt: now, lastSeenAt: now });
      }
      await this.snapshot.write(DATA_FILE, [...updatedMap.values()]);
      this.logger.log(`Baseline saved (${updatedMap.size} entries, no per-listing messages sent)`);
      return;
    }

    for (const listing of currentListings) {
      const prev = updatedMap.get(listing.url);
      if (!prev) {
        // New listing — persist only if notification was delivered (retry next run otherwise).
        if (notifyResult.notifiedNew.has(listing.url)) {
          updatedMap.set(listing.url, { ...listing, firstSeenAt: now, lastSeenAt: now });
        }
        continue;
      }
      // Existing listing: refresh fields (title/price may have edited) + lastSeenAt.
      updatedMap.set(listing.url, {
        ...listing,
        firstSeenAt: prev.firstSeenAt,
        lastSeenAt: now,
      });
    }

    // Items that disappeared from the page are kept in the snapshot — we don't notify on removal,
    // but we also shouldn't re-notify them as "new" if they reappear.

    const pendingCount = result.newListings.filter(
      l => !notifyResult.notifiedNew.has(l.url),
    ).length;
    if (pendingCount > 0) {
      this.logger.warn(
        `${pendingCount} new listing(s) not persisted — notification failed, will retry next run`,
      );
    }

    await this.snapshot.write(DATA_FILE, [...updatedMap.values()]);
    this.logger.log(`Snapshot saved (${updatedMap.size} entries)`);
  }
}
