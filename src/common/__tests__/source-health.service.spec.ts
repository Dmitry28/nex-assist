import type { SnapshotService } from '../snapshot.service';
import {
  ALERT_AFTER_RUNS,
  REPEAT_EVERY_RUNS,
  SourceHealthService,
  type SourceHealthEntry,
} from '../source-health.service';

/** `n` consecutive runs that returned nothing. */
const emptyRuns = (n: number): number[] => Array.from({ length: n }, () => 0);

/** An in-memory stand-in for the on-disk streak file, so a run can be replayed run by run. */
const inMemorySnapshot = (): SnapshotService => {
  let stored: SourceHealthEntry[] = [];
  return {
    read: () => Promise.resolve(stored.map(e => ({ ...e }))),
    write: (_file: string, items: SourceHealthEntry[]) => {
      stored = items.map(e => ({ ...e }));
      return Promise.resolve();
    },
  } as unknown as SnapshotService;
};

describe('SourceHealthService', () => {
  const run = async (
    service: SourceHealthService,
    counts: number[],
    hadData = true,
  ): Promise<Array<string | null>> => {
    const alerts: Array<string | null> = [];
    for (const count of counts) {
      alerts.push((await service.record('pogorany', count, hadData)).alert);
    }
    return alerts;
  };

  let service: SourceHealthService;
  beforeEach(() => {
    service = new SourceHealthService(inMemorySnapshot());
  });

  // Sites go down for a night; that is not worth a message. Four days of silence is.
  it('stays quiet for the first empty runs', async () => {
    const alerts = await run(service, emptyRuns(ALERT_AFTER_RUNS - 1));
    expect(alerts.every(a => a === null)).toBe(true);
  });

  it('speaks up once the streak reaches the threshold', async () => {
    const alerts = await run(service, emptyRuns(ALERT_AFTER_RUNS));
    expect(alerts.slice(0, -1).every(a => a === null)).toBe(true);
    expect(alerts.at(-1)).toContain('pogorany');
    expect(alerts.at(-1)).toContain(String(ALERT_AFTER_RUNS));
  });

  // A source that stays broken must not become the daily noise the watchdog exists to cut through.
  it('does not repeat every run while a source stays empty', async () => {
    const alerts = await run(service, emptyRuns(ALERT_AFTER_RUNS + REPEAT_EVERY_RUNS - 1));
    expect(alerts.filter(Boolean)).toHaveLength(1);
  });

  it('reminds again after the repeat interval', async () => {
    const alerts = await run(service, emptyRuns(ALERT_AFTER_RUNS + REPEAT_EVERY_RUNS));
    expect(alerts.filter(Boolean)).toHaveLength(2);
  });

  it('reports the recovery, so a fixed source is not left looking broken', async () => {
    const alerts = await run(service, [...emptyRuns(ALERT_AFTER_RUNS), 4]);
    expect(alerts.at(-1)).toContain('снова отдаёт данные');
  });

  it('says nothing on a recovery that was never reported', async () => {
    expect(await run(service, [0, 4])).toEqual([null, null]);
  });

  it('starts the count over after a good run', async () => {
    const alerts = await run(service, [...emptyRuns(ALERT_AFTER_RUNS - 1), 4, 0, 0]);
    expect(alerts.filter(a => a?.startsWith('⚠️'))).toHaveLength(0);
  });

  // A brand-new feed has produced nothing yet, so its silence proves nothing.
  it('never alerts for a source that has never returned data', async () => {
    const alerts = await run(service, emptyRuns(ALERT_AFTER_RUNS + REPEAT_EVERY_RUNS), false);
    expect(alerts.filter(Boolean)).toHaveLength(0);
  });

  // Callers without a snapshot to point at (the vacancy sources) pass hadData=false and rely on
  // the watchdog's own record of a working day.
  it('uses its own history as proof the source once worked', async () => {
    await run(service, [7], false);
    const alerts = await run(service, emptyRuns(ALERT_AFTER_RUNS), false);
    expect(alerts.at(-1)).toContain('⚠️');
  });

  it('keeps a streak per source', async () => {
    for (let i = 0; i < ALERT_AFTER_RUNS; i++) {
      await service.record('bamper:kapot', 0, true);
      await service.record('bamper:fara-levaya', 3, true);
    }
    expect((await service.record('bamper:fara-levaya', 3, true)).zeroRuns).toBe(0);
  });
});
