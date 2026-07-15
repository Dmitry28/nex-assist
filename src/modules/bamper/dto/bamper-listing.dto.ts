import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** A single bamper.by used-parts listing (one rear-bumper offer). */
export class BamperListing {
  /**
   * Stable id — the listing slug `<sellerId>-<articul>` from the URL
   * (e.g. "105924-108638066"). Unique per offer and survives front-end rebuilds.
   */
  @ApiProperty() id!: string;
  @ApiProperty() url!: string;
  @ApiProperty() title!: string;
  /** Donor-car year parsed from the title (e.g. 2024). Undefined if not stated. */
  @ApiPropertyOptional() year?: number;
  /** Price in BYN (integer rubles, kopecks dropped). Undefined if "on request". */
  @ApiPropertyOptional() priceByn?: number;
  /** Converted price in USD as shown by the site. Undefined if not shown. */
  @ApiPropertyOptional() priceUsd?: number;
  @ApiPropertyOptional() city?: string;
  @ApiPropertyOptional() photoUrl?: string;
  /** Seller's free-text notes: engine, condition, origin ("Оригинал США"), R-line, etc. */
  @ApiPropertyOptional() description?: string;
  /** Seller positive-feedback rating (karma), e.g. "92%". Not shown for every seller. */
  @ApiPropertyOptional() sellerRating?: string;
}

/** Result of one scrape cycle. */
export class BamperResult {
  @ApiProperty() total!: number;
  @ApiProperty({ type: () => BamperListing, isArray: true }) newListings!: BamperListing[];
  @ApiProperty({ type: () => BamperListing, isArray: true }) removedListings!: BamperListing[];
  @ApiProperty() isBaseline!: boolean;
  @ApiPropertyOptional() skipped?: boolean;
  @ApiPropertyOptional() skipReason?: string;
}

/**
 * Persisted snapshot entry — extends BamperListing with tracking timestamps.
 * Stored in ./data/bamper_atlas_cross_sport_all.json
 */
export interface BamperSnapshotEntry extends BamperListing {
  firstSeenAt: string;
  lastSeenAt: string;
}

/** Type guard for BamperSnapshotEntry — used when reading the snapshot file from disk. */
export const isBamperSnapshotEntry = (item: unknown): item is BamperSnapshotEntry => {
  if (typeof item !== 'object' || item === null) return false;
  const e = item as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.url === 'string' &&
    typeof e.title === 'string' &&
    typeof e.firstSeenAt === 'string' &&
    typeof e.lastSeenAt === 'string'
  );
};
