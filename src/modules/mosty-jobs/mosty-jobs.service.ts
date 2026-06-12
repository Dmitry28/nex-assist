import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { SnapshotService } from '../../common/snapshot.service';
import { DATA_FILE, RUN_TIMEOUT_MS, SNAPSHOT_RETENTION_DAYS } from './constants';
import {
  isJobSnapshotEntry,
  type JobSnapshotEntry,
  type JobVacancy,
  type MostyJobsResult,
} from './dto/job-vacancy.dto';
import { GszParserService } from './gsz-parser.service';
import {
  MostyJobsNotifierService,
  type MostyJobsNotifyResult,
} from './mosty-jobs-notifier.service';
import { RabotaParserService } from './rabota-parser.service';

/**
 * Daily job-vacancy monitor for Мостовский район (Гродненская область).
 *
 * Orchestrates the scrape cycle:
 *   1. Fetch vacancies from gsz.gov.by (state vacancy bank) and rabota.by.
 *   2. Diff against snapshot — report only **new** vacancies (no removed tracking).
 *   3. Send Telegram notifications; only delivered vacancies are persisted.
 *
 * A source returning null means it failed this run — its snapshot entries are
 * left untouched so a one-day outage never floods the chat with re-discovered
 * "new" vacancies afterwards.
 *
 * Baseline is per-source: a source with no snapshot history has its vacancies
 * seeded silently (no per-vacancy messages). This covers both the very first
 * run and the "one source was down on the first run" case.
 */
@Injectable()
export class MostyJobsService {
  private readonly logger = new Logger(MostyJobsService.name);
  private isRunning = false;

  constructor(
    private readonly gszParser: GszParserService,
    private readonly rabotaParser: RabotaParserService,
    private readonly snapshot: SnapshotService,
    private readonly notifier: MostyJobsNotifierService,
  ) {}

  async run(): Promise<MostyJobsResult> {
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

  private async scrape(): Promise<MostyJobsResult> {
    const [gszList, rabotaList, previousEntries] = await Promise.all([
      this.gszParser.fetch(),
      this.rabotaParser.fetch(),
      this.snapshot.read(DATA_FILE, isJobSnapshotEntry),
    ]);

    if (gszList === null && rabotaList === null) {
      throw new Error('Both sources failed — gsz.gov.by and rabota.by are unreachable');
    }

    const currentVacancies = [...(gszList ?? []), ...(rabotaList ?? [])];
    const previousMap = new Map(previousEntries.map(e => [e.url, e]));
    const sourceHasHistory = {
      gsz: previousEntries.some(e => e.source === 'gsz'),
      rabota: previousEntries.some(e => e.source === 'rabota'),
    };

    const newVacancies: JobVacancy[] = [];
    const seededVacancies: JobVacancy[] = [];
    for (const vacancy of currentVacancies) {
      if (previousMap.has(vacancy.url)) continue;
      if (sourceHasHistory[vacancy.source]) newVacancies.push(vacancy);
      else seededVacancies.push(vacancy);
    }

    const result: MostyJobsResult = {
      totalGsz: gszList === null ? null : gszList.length,
      totalRabota: rabotaList === null ? null : rabotaList.length,
      newVacancies,
      seededCount: seededVacancies.length,
    };

    this.logger.log(
      `Diff — gsz: ${result.totalGsz ?? 'failed'}, rabota: ${result.totalRabota ?? 'failed'}, ` +
        `new: ${newVacancies.length}, seeded: ${seededVacancies.length}`,
    );

    const notifyResult = await this.notifier.notifyRunResult(result);
    await this.persistSnapshot({
      currentVacancies,
      seededVacancies,
      previousMap,
      result,
      notifyResult,
    });

    return result;
  }

  private async persistSnapshot({
    currentVacancies,
    seededVacancies,
    previousMap,
    result,
    notifyResult,
  }: {
    currentVacancies: JobVacancy[];
    seededVacancies: JobVacancy[];
    previousMap: Map<string, JobSnapshotEntry>;
    result: MostyJobsResult;
    notifyResult: MostyJobsNotifyResult;
  }): Promise<void> {
    const now = new Date().toISOString();
    const updatedMap = new Map(previousMap);

    // Source baseline — seeded silently, persisted unconditionally.
    const seededUrls = new Set(seededVacancies.map(v => v.url));

    for (const vacancy of currentVacancies) {
      const prev = updatedMap.get(vacancy.url);
      if (!prev) {
        // New vacancy — persist if seeded (baseline) or its notification was
        // delivered (retry next run otherwise).
        if (seededUrls.has(vacancy.url) || notifyResult.notifiedNew.has(vacancy.url)) {
          updatedMap.set(vacancy.url, { ...vacancy, firstSeenAt: now, lastSeenAt: now });
        }
        continue;
      }
      // Existing vacancy: refresh fields (salary may have changed) + lastSeenAt.
      updatedMap.set(vacancy.url, { ...vacancy, firstSeenAt: prev.firstSeenAt, lastSeenAt: now });
    }

    // Vacancies that disappeared from the sources are kept in the snapshot — we don't
    // notify on removal, but we also shouldn't re-notify them as "new" if they reappear.
    // They are pruned after SNAPSHOT_RETENTION_DAYS so the file doesn't grow forever.
    const cutoff = Date.now() - SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const entries = [...updatedMap.values()].filter(
      e => new Date(e.lastSeenAt).getTime() >= cutoff,
    );
    const prunedCount = updatedMap.size - entries.length;
    if (prunedCount > 0) {
      this.logger.log(
        `Pruned ${prunedCount} entries not seen for ${SNAPSHOT_RETENTION_DAYS}+ days`,
      );
    }

    const pendingCount = result.newVacancies.filter(
      v => !notifyResult.notifiedNew.has(v.url),
    ).length;
    if (pendingCount > 0) {
      this.logger.warn(`${pendingCount} new vacancy(ies) not persisted — will retry next run`);
    }

    await this.snapshot.write(DATA_FILE, entries);
    this.logger.log(`Snapshot saved (${entries.length} entries)`);
  }
}
