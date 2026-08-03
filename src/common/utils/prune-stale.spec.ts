import { pruneStale, STALE_AFTER_DAYS } from './prune-stale';

const NOW = new Date('2026-08-03T00:00:00.000Z');
const daysAgo = (n: number): string =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

describe('pruneStale', () => {
  it('keeps an entry seen today', () => {
    const { kept, removed } = pruneStale([{ lastSeenAt: daysAgo(0) }], NOW);
    expect(kept).toHaveLength(1);
    expect(removed).toHaveLength(0);
  });

  it('drops an entry unseen for longer than the window', () => {
    const { kept, removed } = pruneStale([{ lastSeenAt: daysAgo(STALE_AFTER_DAYS + 1) }], NOW);
    expect(kept).toHaveLength(0);
    expect(removed).toHaveLength(1);
  });

  it('keeps an entry exactly at the boundary', () => {
    // Inclusive on purpose: a listing seen exactly at the cutoff is not yet stale.
    expect(pruneStale([{ lastSeenAt: daysAgo(STALE_AFTER_DAYS) }], NOW).kept).toHaveLength(1);
  });

  it('keeps a live listing no matter how long it has been on the market', () => {
    // lastSeenAt advances every run, so age means "absent from the feed", not "listed long ago".
    const oldButLive = { lastSeenAt: daysAgo(0), firstSeenAt: daysAgo(900) };
    expect(pruneStale([oldButLive], NOW).kept).toHaveLength(1);
  });

  it('keeps entries with an unparsable timestamp rather than losing them', () => {
    // Dropping these would re-announce the listing as new — worse than carrying a bad row.
    const { kept, removed } = pruneStale([{ lastSeenAt: 'not-a-date' }], NOW);
    expect(kept).toHaveLength(1);
    expect(removed).toHaveLength(0);
  });

  it('splits a mixed set and preserves order within each side', () => {
    const entries = [
      { lastSeenAt: daysAgo(1), id: 'live' },
      { lastSeenAt: daysAgo(400), id: 'gone-a' },
      { lastSeenAt: daysAgo(10), id: 'recent' },
      { lastSeenAt: daysAgo(365), id: 'gone-b' },
    ];
    const { kept, removed } = pruneStale(entries, NOW);
    expect(kept.map(e => e.id)).toEqual(['live', 'recent']);
    expect(removed.map(e => e.id)).toEqual(['gone-a', 'gone-b']);
  });

  it('honours a custom window', () => {
    expect(pruneStale([{ lastSeenAt: daysAgo(45) }], NOW, 30).removed).toHaveLength(1);
    expect(pruneStale([{ lastSeenAt: daysAgo(45) }], NOW, 90).removed).toHaveLength(0);
  });

  it('handles an empty snapshot', () => {
    expect(pruneStale([], NOW)).toEqual({ kept: [], removed: [] });
  });
});
