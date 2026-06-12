import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { SnapshotService } from '../../common/snapshot.service';
import { DATA_FILE, RUN_TIMEOUT_MS, SNAPSHOT_RETENTION_DAYS } from './constants';
import {
  isJobSnapshotEntry,
  type JobSnapshotEntry,
  type JobSource,
  type JobVacancy,
  type MostyJobsResult,
} from './dto/job-vacancy.dto';
import { GszParserService } from './gsz-parser.service';
import { JoblabParserService } from './joblab-parser.service';
import { KufarJobsParserService } from './kufar-jobs-parser.service';
import { dedupeKey } from './mosty-jobs-dedupe';
import {
  MostyJobsNotifierService,
  type MostyJobsNotifyResult,
} from './mosty-jobs-notifier.service';
import { RabotaParserService } from './rabota-parser.service';

/**
 * Daily job-vacancy monitor for Мостовский район (Гродненская область).
 *
 * Orchestrates the scrape cycle:
 *   1. Fetch vacancies from all sources (state bank + commercial boards).
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
 *
 * Cross-source dedupe: boards syndicate each other (joblab/aggregators repost
 * gsz and rabota.by listings). A new vacancy whose title+employer is already
 * known from another source is persisted silently. Source order below is the
 * notification priority — state bank first.
 */
@Injectable()
export class MostyJobsService {
  private readonly logger = new Logger(MostyJobsService.name);
  private isRunning = false;

  constructor(
    private readonly gszParser: GszParserService,
    private readonly rabotaParser: RabotaParserService,
    private readonly joblabParser: JoblabParserService,
    private readonly kufarParser: KufarJobsParserService,
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
    // Order = notification priority for cross-source duplicates.
    const sources: Array<{ source: JobSource; fetch: () => Promise<JobVacancy[] | null> }> = [
      { source: 'gsz', fetch: () => this.gszParser.fetch() },
      { source: 'rabota', fetch: () => this.rabotaParser.fetch() },
      { source: 'joblab', fetch: () => this.joblabParser.fetch() },
      { source: 'kufar', fetch: () => this.kufarParser.fetch() },
    ];

    const [lists, previousEntries] = await Promise.all([
      Promise.all(sources.map(s => s.fetch())),
      this.snapshot.read(DATA_FILE, isJobSnapshotEntry),
    ]);

    if (lists.every(list => list === null)) {
      throw new Error('All vacancy sources failed');
    }

    const previousMap = new Map(previousEntries.map(e => [e.url, e]));
    const historySources = new Set(previousEntries.map(e => e.source));
    // Keys of every vacancy already known — duplicates across sources are silenced.
    const knownKeys = new Set(previousEntries.map(dedupeKey));

    const currentVacancies: JobVacancy[] = [];
    const newVacancies: JobVacancy[] = [];
    const silentVacancies: JobVacancy[] = []; // seeded baseline + cross-source duplicates
    let seededCount = 0;
    let duplicateCount = 0;

    for (const [i, { source }] of sources.entries()) {
      const list = lists[i];
      if (list === null) continue;
      for (const vacancy of list) {
        currentVacancies.push(vacancy);
        if (previousMap.has(vacancy.url)) continue;

        if (!historySources.has(source)) {
          silentVacancies.push(vacancy);
          seededCount++;
        } else if (knownKeys.has(dedupeKey(vacancy))) {
          silentVacancies.push(vacancy);
          duplicateCount++;
        } else {
          newVacancies.push(vacancy);
        }
        knownKeys.add(dedupeKey(vacancy));
      }
    }

    const totals = Object.fromEntries(
      sources.map(({ source }, i) => [source, lists[i] === null ? null : lists[i].length]),
    ) as Record<JobSource, number | null>;

    const result: MostyJobsResult = { totals, newVacancies, seededCount, duplicateCount };

    this.logger.log(
      `Diff — ${sources
        .map(({ source }) => `${source}: ${totals[source] ?? 'failed'}`)
        .join(', ')} | new: ${newVacancies.length}, seeded: ${seededCount}, dup: ${duplicateCount}`,
    );

    const notifyResult = await this.notifier.notifyRunResult(result);
    await this.persistSnapshot({
      currentVacancies,
      silentVacancies,
      previousMap,
      result,
      notifyResult,
    });

    return result;
  }

  private async persistSnapshot({
    currentVacancies,
    silentVacancies,
    previousMap,
    result,
    notifyResult,
  }: {
    currentVacancies: JobVacancy[];
    silentVacancies: JobVacancy[];
    previousMap: Map<string, JobSnapshotEntry>;
    result: MostyJobsResult;
    notifyResult: MostyJobsNotifyResult;
  }): Promise<void> {
    const now = new Date().toISOString();
    const updatedMap = new Map(previousMap);

    // Baseline-seeded and cross-source duplicates — persisted unconditionally, no messages.
    const silentUrls = new Set(silentVacancies.map(v => v.url));

    for (const vacancy of currentVacancies) {
      const prev = updatedMap.get(vacancy.url);
      if (!prev) {
        // New vacancy — persist if silent (seeded/duplicate) or its notification
        // was delivered (retry next run otherwise).
        if (silentUrls.has(vacancy.url) || notifyResult.notifiedNew.has(vacancy.url)) {
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
