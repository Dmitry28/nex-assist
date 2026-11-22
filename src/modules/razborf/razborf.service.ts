import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SnapshotService } from '../../common/snapshot.service';
import { SourceHealthService } from '../../common/source-health.service';
import { RETENTION_DAYS, RUN_TIMEOUT_MS, SNAPSHOT_FILE } from './constants';
import {
  isRazborfSnapshotEntry,
  type RazborfListing,
  type RazborfResult,
  type RazborfSnapshotEntry,
} from './dto/razborf-listing.dto';
import { RazborfNotifierService, type RazborfNotifyResult } from './razborf-notifier.service';
import { RazborfParserService } from './razborf-parser.service';

/**
 * Orchestrates the razborf.by scrape cycle (a single Minsk breaker's yard, Atlas restailing 2):
 *   1. Read the model's part index, keep the wanted categories that have stock.
 *   2. Fetch each category page → listings.
 *   3. Diff against the snapshot → new listings; notify; persist only what was delivered.
 *
 * No year filter: the model itself is 2023-2026, the restyle. No removals either — categories
 * come and go with stock, so entries age out after RETENTION_DAYS instead (see constants).
 */
@Injectable()
export class RazborfService {
  private readonly logger = new Logger(RazborfService.name);
  private isRunning = false;

  constructor(
    private readonly config: ConfigService,
    private readonly parser: RazborfParserService,
    private readonly snapshot: SnapshotService,
    private readonly notifier: RazborfNotifierService,
    private readonly health: SourceHealthService,
  ) {}

  async run(): Promise<RazborfResult> {
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

  private async scrape(): Promise<RazborfResult> {
    const modelUrl = this.config.get<string>('razborf.modelUrl') ?? '';

    const [categories, previousEntries] = await Promise.all([
      this.parser.fetchCategories(modelUrl),
      this.snapshot.read(SNAPSHOT_FILE, isRazborfSnapshotEntry),
    ]);
    const pages = await this.parser.fetchCategoryPages(categories);

    const current = new Map<string, RazborfListing>();
    const failedCategories: string[] = [];
    const stocked: string[] = [];
    for (const { category, listings } of pages) {
      if (listings === null) {
        failedCategories.push(category.name);
        continue;
      }
      if (listings.length > 0) stocked.push(category.name);
      for (const l of listings) current.set(l.id, l);
    }
    // All wanted categories failing is a source outage, not a quiet day.
    if (pages.length > 0 && failedCategories.length === pages.length) {
      throw new Error('All razborf.by category pages failed to fetch');
    }

    const previousMap = new Map(previousEntries.map(e => [e.id, e]));
    const { alert } = await this.health.record(
      'razborf',
      current.size + failedCategories.length,
      previousEntries.length > 0,
    );
    if (alert) await this.notifier.notifyHealth(alert);

    const newListings = [...current.values()].filter(l => !previousMap.has(l.id));
    const result: RazborfResult = {
      total: current.size,
      categories: stocked,
      newListings,
      isBaseline: previousMap.size === 0 && current.size > 0,
      failedCategories,
    };
    this.logger.log(
      `Diff — in stock: ${result.total}, new: ${newListings.length}${result.isBaseline ? ' [BASELINE]' : ''}`,
    );

    const notifyResult = await this.notifier.notifyRunResult(result);
    await this.persistSnapshot([...current.values()], previousMap, notifyResult);
    return result;
  }

  private async persistSnapshot(
    current: RazborfListing[],
    previousMap: Map<string, RazborfSnapshotEntry>,
    notifyResult: RazborfNotifyResult,
  ): Promise<void> {
    const now = new Date();
    const nowIso = now.toISOString();

    const updated = new Map(previousMap);
    for (const listing of current) {
      const prev = updated.get(listing.id);
      if (!prev) {
        // New listing — persist only if notified, so a Telegram failure retries next run.
        if (notifyResult.notifiedNew.has(listing.id)) {
          updated.set(listing.id, { ...listing, firstSeenAt: nowIso, lastSeenAt: nowIso });
        }
      } else {
        updated.set(listing.id, { ...prev, ...listing, lastSeenAt: nowIso });
      }
    }

    const cutoff = now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const [id, entry] of [...updated]) {
      if (new Date(entry.lastSeenAt).getTime() < cutoff) updated.delete(id);
    }

    const pending = current.filter(
      l => !previousMap.has(l.id) && !notifyResult.notifiedNew.has(l.id),
    ).length;
    if (pending > 0) {
      this.logger.warn(`${pending} new listing(s) not persisted — send failed, retry next run`);
    }

    await this.snapshot.write(SNAPSHOT_FILE, [...updated.values()]);
    this.logger.log(`Snapshot saved (${updated.size} entries)`);
  }
}
