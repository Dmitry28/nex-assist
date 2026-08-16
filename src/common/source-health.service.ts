import { Injectable, Logger } from '@nestjs/common';
import { SnapshotService } from './snapshot.service';

/** Where the streak counters live. Committed with the other snapshots by the daily workflow. */
const DATA_FILE = './data/source_health.json';

/**
 * Consecutive empty runs before a source is called broken. Two is noise — sites go down for a
 * night — and three is one missed day plus a confirmation, which is early enough: gsz was empty
 * for four days and pogorany for twelve before anyone noticed.
 */
export const ALERT_AFTER_RUNS = 3;

/** Once alerted, repeat only this often, so a source that stays down does not become the noise. */
export const REPEAT_EVERY_RUNS = 7;

/** One source's streak, persisted between runs. */
export interface SourceHealthEntry {
  /** Stable key, e.g. "pogorany" or "bamper:atlas-hood". */
  source: string;
  /** Consecutive runs that returned nothing while the snapshot held data. */
  zeroRuns: number;
  /** zeroRuns at the last alert — 0 when no alert is outstanding. */
  alertedAt: number;
  /** ISO timestamp of the last run that returned anything. */
  lastNonEmptyAt?: string;
}

export const isSourceHealthEntry = (item: unknown): item is SourceHealthEntry => {
  if (typeof item !== 'object' || item === null) return false;
  const e = item as Record<string, unknown>;
  return typeof e.source === 'string' && typeof e.zeroRuns === 'number';
};

/** What the caller should tell the user, if anything. */
export interface SourceHealthVerdict {
  /** Message to send, or null when this run says nothing new. */
  alert: string | null;
  zeroRuns: number;
}

/**
 * Watches for the failure that costs the most and shows the least: a source that returns nothing
 * while its site is up and full of listings. Every module already guards against wiping a
 * snapshot on an empty parse, and that guard is exactly the moment worth counting — it fires when
 * a source had data yesterday and has none today.
 *
 * Four outages found on 2026-08-16 were all this shape: bamper (3 days), gsz (4), pogorany (12)
 * and bid.cars sold prices (since the feature shipped). Each one logged a warning nobody reads
 * and reported "nothing new" to Telegram, which is indistinguishable from a quiet market.
 */
@Injectable()
export class SourceHealthService {
  private readonly logger = new Logger(SourceHealthService.name);

  constructor(private readonly snapshot: SnapshotService) {}

  /**
   * Record what a source returned this run and decide whether to speak up.
   *
   * `count` is what the parser produced, `hadData` whether the snapshot holds anything — a
   * source that has never had data cannot have lost it, so a first run stays silent.
   */
  async record(source: string, count: number, hadData: boolean): Promise<SourceHealthVerdict> {
    const entries = await this.snapshot.read(DATA_FILE, isSourceHealthEntry);
    const byKey = new Map(entries.map(e => [e.source, e]));
    const entry: SourceHealthEntry = byKey.get(source) ?? { source, zeroRuns: 0, alertedAt: 0 };

    const verdict = count > 0 ? this.recovered(entry) : this.stillEmpty(entry, hadData);

    byKey.set(source, entry);
    await this.snapshot.write(DATA_FILE, [...byKey.values()]);
    return verdict;
  }

  /** A source that produced something clears its streak — and says so if it had been reported. */
  private recovered(entry: SourceHealthEntry): SourceHealthVerdict {
    const wasAlerted = entry.alertedAt > 0;
    const brokenFor = entry.zeroRuns;
    entry.zeroRuns = 0;
    entry.alertedAt = 0;
    entry.lastNonEmptyAt = new Date().toISOString();

    return {
      alert: wasAlerted
        ? `✅ Источник «${entry.source}» снова отдаёт данные (пустовал ${brokenFor} прогон(ов) подряд)`
        : null,
      zeroRuns: 0,
    };
  }

  /** An empty run: count it, and speak at the threshold and then only on the repeat interval. */
  private stillEmpty(entry: SourceHealthEntry, hadData: boolean): SourceHealthVerdict {
    entry.zeroRuns += 1;

    // A source that has never produced anything has nothing to have lost — a brand-new feed
    // would otherwise alert on its very first quiet day. Either the caller's snapshot or our own
    // history is proof enough that it once worked.
    const everWorked = hadData || entry.lastNonEmptyAt !== undefined;
    if (!everWorked || entry.zeroRuns < ALERT_AFTER_RUNS) {
      return { alert: null, zeroRuns: entry.zeroRuns };
    }
    if (entry.alertedAt > 0 && entry.zeroRuns - entry.alertedAt < REPEAT_EVERY_RUNS) {
      return { alert: null, zeroRuns: entry.zeroRuns };
    }

    entry.alertedAt = entry.zeroRuns;
    const since = entry.lastNonEmptyAt ? ` Последние данные: ${entry.lastNonEmptyAt}.` : '';
    this.logger.warn(`Source "${entry.source}" empty for ${entry.zeroRuns} consecutive runs`);

    return {
      alert:
        `⚠️ Источник «${entry.source}» пуст ${entry.zeroRuns} прогон(ов) подряд, ` +
        `а раньше отдавал данные — похоже, сломался парсер, а не рынок.${since}`,
      zeroRuns: entry.zeroRuns,
    };
  }
}
