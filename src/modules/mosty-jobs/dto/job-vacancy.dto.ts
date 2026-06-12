import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Vacancy source:
 *  - gsz — gsz.gov.by state vacancy bank (by law covers most real local vacancies)
 *  - rabota — rabota.by (hh.ru Belarus)
 *  - joblab — joblab.by (commercial job board, RSS)
 *  - kufar — kufar.by job ads (private/informal)
 *
 * praca.by was evaluated and rejected: its "Мосты" pool is ~95% nationwide
 * remote/blanket postings from Minsk firms (sampled detail pages don't even
 * mention Мосты), while its genuinely local slice duplicates gsz.
 */
export type JobSource = 'gsz' | 'rabota' | 'joblab' | 'kufar';

export const JOB_SOURCES: readonly JobSource[] = ['gsz', 'rabota', 'joblab', 'kufar'];

const isJobSource = (v: unknown): v is JobSource =>
  typeof v === 'string' && (JOB_SOURCES as readonly string[]).includes(v);

/** A single job vacancy in Мостовский район, normalized across sources. */
export class JobVacancy {
  /** Absolute vacancy URL — used as the unique key for diffing. */
  @ApiProperty() url!: string;
  @ApiProperty({ enum: ['gsz', 'rabota'] }) source!: JobSource;
  @ApiProperty() title!: string;
  @ApiPropertyOptional() employer?: string;
  /** Human-readable salary line, e.g. "1 400 – 1 500 руб." or "от 900 руб.". */
  @ApiPropertyOptional() salary?: string;
  /** Workplace address (gsz) or area name (rabota.by). */
  @ApiPropertyOptional() address?: string;
}

/** Result of one scrape cycle. `null` total means the source failed this run. */
export class MostyJobsResult {
  /** Per-source vacancy totals; null = the source failed this run. */
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number', nullable: true } })
  totals!: Record<JobSource, number | null>;
  @ApiProperty({ type: () => JobVacancy, isArray: true }) newVacancies!: JobVacancy[];
  /**
   * Vacancies seeded silently because their source had no snapshot history yet
   * (first run of that source) — persisted without per-vacancy notifications.
   */
  @ApiProperty() seededCount!: number;
  /**
   * New vacancies suppressed as cross-source duplicates (same title+employer
   * already known from another source) — persisted without notifications.
   */
  @ApiProperty() duplicateCount!: number;
}

/**
 * Persisted snapshot entry — extends JobVacancy with tracking timestamps.
 * Stored in ./data/mosty_jobs.json
 */
export interface JobSnapshotEntry extends JobVacancy {
  firstSeenAt: string;
  lastSeenAt: string;
}

/** Type guard for JobSnapshotEntry — used when reading the snapshot file from disk. */
export const isJobSnapshotEntry = (item: unknown): item is JobSnapshotEntry => {
  if (typeof item !== 'object' || item === null) return false;
  const e = item as Record<string, unknown>;
  return (
    typeof e.url === 'string' &&
    isJobSource(e.source) &&
    typeof e.title === 'string' &&
    typeof e.firstSeenAt === 'string' &&
    typeof e.lastSeenAt === 'string'
  );
};
