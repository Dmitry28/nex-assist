/**
 * Drops snapshot entries that have not been seen for a long time.
 *
 * The kufar, realt and townhouses snapshots only ever grow: they record what a feed returned
 * and never remove anything, because these sites give no "withdrawn" signal. A delisted ad
 * therefore sits in the file forever — kufar's houses snapshot held 1115 entries against 548
 * live listings, and 465 of those had not been seen in a month.
 *
 * `lastSeenAt` advances on every run while an ad is live, so age here means "absent from the
 * feed this long", not "listed this long ago". A live ad is never pruned however old it is.
 */

/** Entries unseen for longer than this are dropped. */
export const STALE_AFTER_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PrunableEntry {
  lastSeenAt: string;
}

/**
 * Splits entries into those to keep and those to drop.
 *
 * A missing or unparsable `lastSeenAt` is kept rather than dropped: losing a row to a bad
 * timestamp would make that listing look new again on the next run, which is worse than
 * carrying it.
 */
export const pruneStale = <T extends PrunableEntry>(
  entries: T[],
  now: Date,
  staleAfterDays: number = STALE_AFTER_DAYS,
): { kept: T[]; removed: T[] } => {
  const cutoff = now.getTime() - staleAfterDays * DAY_MS;
  const kept: T[] = [];
  const removed: T[] = [];

  for (const entry of entries) {
    const seen = new Date(entry.lastSeenAt).getTime();
    if (!isFinite(seen) || seen >= cutoff) kept.push(entry);
    else removed.push(entry);
  }

  return { kept, removed };
};
