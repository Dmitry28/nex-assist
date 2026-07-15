import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SnapshotService } from '../../common/snapshot.service';
import { BamperNotifierService, type BamperNotifyResult } from './bamper-notifier.service';
import { BamperParserService } from './bamper-parser.service';
import { DATA_FILE, RUN_TIMEOUT_MS } from './constants';
import {
  isBamperSnapshotEntry,
  type BamperListing,
  type BamperResult,
  type BamperSnapshotEntry,
} from './dto/bamper-listing.dto';

/**
 * Orchestrates the bamper.by scrape cycle:
 *   1. Fetch current rear-bumper listings (Puppeteer, behind Cloudflare).
 *   2. Diff against the snapshot → new / removed listings.
 *   3. Notify new listings — only what was successfully sent gets persisted.
 *   4. Persist the updated snapshot.
 *
 * The search URL already narrows to VW Atlas Cross Sport, restyle years (2023-2026),
 * so every listing here is a compatibility candidate for the owner's 2025 car.
 */
@Injectable()
export class BamperService {
  private readonly logger = new Logger(BamperService.name);
  private isRunning = false;

  constructor(
    private readonly config: ConfigService,
    private readonly parser: BamperParserService,
    private readonly snapshot: SnapshotService,
    private readonly notifier: BamperNotifierService,
  ) {}

  async run(): Promise<BamperResult> {
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

  private async scrape(): Promise<BamperResult> {
    const searchUrl = this.config.getOrThrow<string>('bamper.searchUrl');

    const [current, previousEntries] = await Promise.all([
      this.parser.fetch(searchUrl),
      this.snapshot.read(DATA_FILE, isBamperSnapshotEntry),
    ]);

    // Defensive: never wipe a non-empty snapshot if the parser yields nothing (e.g. a
    // Cloudflare block that slipped through) — that would re-notify everything next run.
    if (current.length === 0 && previousEntries.length > 0) {
      this.logger.warn('Parser returned 0 listings but snapshot is non-empty — skipping diff');
      return {
        total: previousEntries.length,
        newListings: [],
        removedListings: [],
        isBaseline: false,
      };
    }

    const previousMap = new Map(previousEntries.map(e => [e.id, e]));
    const currentIds = new Set(current.map(c => c.id));
    const isBaseline = previousMap.size === 0 && current.length > 0;

    const newListings = current.filter(c => !previousMap.has(c.id));
    const removedListings = previousEntries.filter(p => !currentIds.has(p.id));

    const result: BamperResult = {
      total: current.length,
      newListings,
      removedListings,
      isBaseline,
    };
    this.logger.log(
      `Diff — total: ${result.total}, new: ${newListings.length}, removed: ${removedListings.length}${isBaseline ? ' [BASELINE]' : ''}`,
    );

    const notifyResult = await this.notifier.notifyRunResult(result);
    await this.persistSnapshot(current, previousMap, result, notifyResult);

    return result;
  }

  private async persistSnapshot(
    current: BamperListing[],
    previousMap: Map<string, BamperSnapshotEntry>,
    result: BamperResult,
    notifyResult: BamperNotifyResult,
  ): Promise<void> {
    const now = new Date().toISOString();

    // Baseline: persist everything unconditionally — no per-listing messages were sent.
    if (result.isBaseline) {
      const seeded = current.map<BamperSnapshotEntry>(l => ({
        ...l,
        firstSeenAt: now,
        lastSeenAt: now,
      }));
      await this.snapshot.write(DATA_FILE, seeded);
      this.logger.log(`Baseline saved (${seeded.length} entries, no messages sent)`);
      return;
    }

    const updated = new Map(previousMap);
    for (const listing of current) {
      const prev = updated.get(listing.id);
      if (!prev) {
        // New listing — persist only if notified, so a Telegram failure retries next run.
        if (notifyResult.notifiedNew.has(listing.id)) {
          updated.set(listing.id, { ...listing, firstSeenAt: now, lastSeenAt: now });
        }
      } else {
        updated.set(listing.id, { ...prev, ...listing, lastSeenAt: now });
      }
    }

    // Drop entries that disappeared from the current results.
    const currentIds = new Set(current.map(c => c.id));
    for (const id of [...updated.keys()]) {
      if (!currentIds.has(id)) updated.delete(id);
    }

    const pending = result.newListings.filter(l => !notifyResult.notifiedNew.has(l.id)).length;
    if (pending > 0) {
      this.logger.warn(`${pending} new listing(s) not persisted — send failed, retry next run`);
    }

    await this.snapshot.write(DATA_FILE, [...updated.values()]);
    this.logger.log(`Snapshot saved (${updated.size} entries)`);
  }
}
