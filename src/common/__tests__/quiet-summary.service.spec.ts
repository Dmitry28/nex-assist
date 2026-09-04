import { QuietSummaryService } from '../quiet-summary.service';
import type { NotifyStateEntry } from '../quiet-summary.service';
import type { SnapshotService } from '../snapshot.service';

/** An in-memory stand-in for the on-disk state file, so runs can be replayed day by day. */
const inMemorySnapshot = (): SnapshotService => {
  let stored: NotifyStateEntry[] = [];
  return {
    read: () => Promise.resolve(stored.map(e => ({ ...e }))),
    write: (_file: string, items: NotifyStateEntry[]) => {
      stored = items.map(e => ({ ...e }));
      return Promise.resolve();
    },
  } as unknown as SnapshotService;
};

const SUMMARY = '<b>Сводка</b>\nВсего: 3';

// 12:00 Minsk on each day, so the Minsk calendar day is never ambiguous.
const at = (day: string): Date => new Date(`${day}T09:00:00Z`);
const MONDAY = '2026-08-31';
const SUNDAY = '2026-09-06';
const NEXT_SUNDAY = '2026-09-13';

describe('QuietSummaryService', () => {
  let service: QuietSummaryService;
  let sent: string[];
  const send = (text: string): Promise<boolean> => {
    sent.push(text);
    return Promise.resolve(true);
  };

  const run = ({
    day,
    hasChanges,
    send: sender = send,
  }: {
    day: string;
    hasChanges: boolean;
    send?: (text: string) => Promise<boolean>;
  }): Promise<{ delivered: boolean; sent: boolean }> => {
    jest.setSystemTime(at(day));
    return service.sendSummary({ module: 'bamper', hasChanges, summary: SUMMARY, send: sender });
  };

  /** Replays every day from `from` up to (and including) `to` with nothing to report. */
  const quietDaysUntil = async (from: string, to: string): Promise<void> => {
    for (let day = new Date(`${from}T09:00:00Z`); ; day = new Date(day.getTime() + 86_400_000)) {
      const iso = day.toISOString().slice(0, 10);
      await run({ day: iso, hasChanges: false });
      if (iso === to) return;
    }
  };

  beforeEach(() => {
    jest.useFakeTimers();
    service = new QuietSummaryService(inMemorySnapshot());
    sent = [];
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sends the summary on a run that found something', async () => {
    const outcome = await run({ day: MONDAY, hasChanges: true });
    expect(sent).toEqual([SUMMARY]);
    expect(outcome).toEqual({ delivered: true, sent: true });
  });

  // The whole point: a daily monitor with nothing to say says nothing.
  it('sends nothing on a run with no changes', async () => {
    const outcome = await run({ day: MONDAY, hasChanges: false });
    expect(sent).toEqual([]);
    expect(outcome).toEqual({ delivered: true, sent: false });
  });

  it('reports the quiet week on Sunday once a full week has passed', async () => {
    await run({ day: MONDAY, hasChanges: true });
    sent = [];
    await quietDaysUntil('2026-09-01', NEXT_SUNDAY);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('ничего нового');
    expect(sent[0]).toContain(SUMMARY);
  });

  // A quiet Sunday that follows a message earlier in the week is not a quiet week.
  it('stays quiet on a Sunday less than a week after the last message', async () => {
    await run({ day: MONDAY, hasChanges: true });
    sent = [];
    await quietDaysUntil('2026-09-01', SUNDAY);

    expect(sent).toEqual([]);
  });

  it('reports only once when the workflow runs twice on the same Sunday', async () => {
    await run({ day: MONDAY, hasChanges: true });
    sent = [];
    await quietDaysUntil('2026-09-01', NEXT_SUNDAY);
    await run({ day: NEXT_SUNDAY, hasChanges: false });

    expect(sent).toHaveLength(1);
  });

  it('restarts the week when something is reported in between', async () => {
    await quietDaysUntil('2026-08-24', '2026-09-03');
    await run({ day: '2026-09-04', hasChanges: true });
    sent = [];
    await run({ day: '2026-09-05', hasChanges: false });
    await run({ day: SUNDAY, hasChanges: false });

    expect(sent).toEqual([]);
  });

  // The caller persists its snapshot only when the summary was delivered, so a rejected
  // summary must report failure — and the same changes go out again next run.
  it('reports a rejected summary as undelivered', async () => {
    const outcome = await run({
      day: MONDAY,
      hasChanges: true,
      send: () => Promise.resolve(false),
    });
    expect(outcome).toEqual({ delivered: false, sent: false });
  });

  it('keeps the streak alive after a rejected summary', async () => {
    await run({ day: MONDAY, hasChanges: true, send: () => Promise.resolve(false) });
    sent = [];
    await quietDaysUntil('2026-09-01', NEXT_SUNDAY);

    // The rejected summary never reached the chat, so it does not count as a message: the
    // streak keeps running from the first tracked run and the quiet week is reported.
    expect(sent).toHaveLength(1);
  });
});
