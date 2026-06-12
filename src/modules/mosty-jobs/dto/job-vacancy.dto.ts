import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Vacancy source: gsz.gov.by (state vacancy bank) or rabota.by (hh.ru Belarus). */
export type JobSource = 'gsz' | 'rabota';

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
  @ApiProperty({ nullable: true, type: Number }) totalGsz!: number | null;
  @ApiProperty({ nullable: true, type: Number }) totalRabota!: number | null;
  @ApiProperty({ type: () => JobVacancy, isArray: true }) newVacancies!: JobVacancy[];
  /**
   * Vacancies seeded silently because their source had no snapshot history yet
   * (first run of that source) — persisted without per-vacancy notifications.
   */
  @ApiProperty() seededCount!: number;
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
    (e.source === 'gsz' || e.source === 'rabota') &&
    typeof e.title === 'string' &&
    typeof e.firstSeenAt === 'string' &&
    typeof e.lastSeenAt === 'string'
  );
};
