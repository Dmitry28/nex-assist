import { Injectable, Logger } from '@nestjs/common';
import { SnapshotService } from './snapshot.service';
import { LOCALE, TIMEZONE } from './utils/locale';

/** Where the per-module quiet streaks live. Committed with the other snapshots by the workflow. */
const DATA_FILE = './data/notify_state.json';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days of silence before the weekly "nothing new" report is worth sending. */
export const QUIET_REPORT_AFTER_DAYS = 7;

/** Minsk weekday the weekly report goes out on — 0 = Sunday, the end of the week. */
export const QUIET_REPORT_WEEKDAY = 0;

/** One module's notification history, persisted between runs. */
export interface NotifyStateEntry {
  /** Stable key, e.g. "bamper" or "land-auctions". */
  module: string;
  /** ISO timestamp of the first run tracked here — start of the streak when nothing ever changed. */
  trackedSince: string;
  /** ISO timestamp of the last run that had something to report. */
  lastChangeAt?: string;
  /** ISO timestamp of the last weekly "nothing new" report. */
  lastQuietReportAt?: string;
}

export const isNotifyStateEntry = (item: unknown): item is NotifyStateEntry => {
  if (typeof item !== 'object' || item === null) return false;
  const e = item as Record<string, unknown>;
  return typeof e.module === 'string' && typeof e.trackedSince === 'string';
};

export interface QuietSummaryParams {
  /** Stable state key for this module. */
  module: string;
  /** True when the run found anything worth a message (new/removed/price change/baseline). */
  hasChanges: boolean;
  /** The module's own run summary — sent as-is on a run with changes. */
  summary: string;
  /** Sends one message to the module's chat; returns whether Telegram accepted it. */
  send: (text: string) => Promise<boolean>;
}

export interface QuietSummaryOutcome {
  /**
   * False only when a message was attempted and Telegram rejected it. Callers gate snapshot
   * persistence on this, so a quiet run reports true — there is nothing to hold back.
   */
  delivered: boolean;
  /** Whether anything was actually sent. False on a quiet run. */
  sent: boolean;
}

/** "2026-09-04" in Minsk, whatever the runner's own timezone is. */
const minskDate = (date: Date): string => date.toLocaleDateString('en-CA', { timeZone: TIMEZONE });

/** Weekday (0 = Sunday) of the Minsk calendar day the instant falls on. */
const minskWeekday = (date: Date): number => new Date(`${minskDate(date)}T12:00:00Z`).getUTCDay();

const daysBetween = (fromIso: string, to: Date): number =>
  Math.floor((to.getTime() - new Date(fromIso).getTime()) / DAY_MS);

const buildQuietReport = ({
  summary,
  quietSince,
  quietDays,
}: {
  summary: string;
  quietSince: string;
  quietDays: number;
}): string => {
  const since = new Date(quietSince).toLocaleDateString(LOCALE, { timeZone: TIMEZONE });
  return [
    '<b>🔇 За неделю ничего нового</b>',
    `Тишина с ${since} — ${quietDays} дн. Текущие итоги:`,
    '',
    summary,
  ].join('\n');
};

/**
 * Keeps a daily monitor from saying "nothing new" every single day.
 *
 * A run with no new, removed or re-priced listings sends nothing at all; the streak is counted
 * instead, and once a full week has passed without a single message the Sunday run sends one
 * report saying the week was quiet — so silence still gets confirmed, but weekly instead of daily.
 *
 * Errors and source-health alerts do not come through here: a broken parser must always speak up,
 * or the quiet report becomes a promise the monitor cannot keep.
 */
@Injectable()
export class QuietSummaryService {
  private readonly logger = new Logger(QuietSummaryService.name);

  constructor(private readonly snapshot: SnapshotService) {}

  /**
   * Send the run summary, or stay quiet when the run found nothing.
   *
   * The caller keeps ownership of the actual sending (chat id, formatting) and passes it in as
   * `send` — this service only decides whether a message goes out and what it says.
   */
  async sendSummary({
    module,
    hasChanges,
    summary,
    send,
  }: QuietSummaryParams): Promise<QuietSummaryOutcome> {
    const now = new Date();
    const entries = await this.snapshot.read(DATA_FILE, isNotifyStateEntry);
    const byModule = new Map(entries.map(e => [e.module, e]));
    const entry: NotifyStateEntry = byModule.get(module) ?? {
      module,
      trackedSince: now.toISOString(),
    };
    const save = async (): Promise<void> => {
      byModule.set(module, entry);
      await this.snapshot.write(DATA_FILE, [...byModule.values()]);
    };

    if (hasChanges) {
      const ok = await send(summary);
      // A rejected summary leaves the streak untouched: the caller will not persist the diff
      // either, so the next run reports the same changes and gets another chance to be seen.
      if (ok) entry.lastChangeAt = now.toISOString();
      await save();
      return { delivered: ok, sent: ok };
    }

    const quietSince = entry.lastChangeAt ?? entry.trackedSince;
    const quietDays = daysBetween(quietSince, now);

    if (!this.isReportDue({ entry, now, quietDays })) {
      this.logger.log(`Nothing new — staying quiet (${quietDays} quiet day(s))`);
      await save();
      return { delivered: true, sent: false };
    }

    const ok = await send(buildQuietReport({ summary, quietSince, quietDays }));
    if (ok) entry.lastQuietReportAt = now.toISOString();
    else this.logger.warn('Failed to send the weekly quiet report');
    await save();
    // Nothing changed this run, so nothing is waiting on delivery — persistence may proceed.
    return { delivered: true, sent: ok };
  }

  private isReportDue({
    entry,
    now,
    quietDays,
  }: {
    entry: NotifyStateEntry;
    now: Date;
    quietDays: number;
  }): boolean {
    if (minskWeekday(now) !== QUIET_REPORT_WEEKDAY) return false;
    if (quietDays < QUIET_REPORT_AFTER_DAYS) return false;
    // One report per quiet day, however many times the workflow runs.
    return entry.lastQuietReportAt === undefined
      ? true
      : minskDate(new Date(entry.lastQuietReportAt)) !== minskDate(now);
  }
}
