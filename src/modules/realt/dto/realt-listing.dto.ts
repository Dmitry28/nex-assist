import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** A single realt.by real-estate listing (currently plots only). */
export class RealtListing {
  /** Stable numeric identifier (realt.by `code`). */
  @ApiProperty() adId!: number;
  /** Stable UUID — kept alongside adId for cross-reference; not used for diffing. */
  @ApiProperty() uuid!: string;
  @ApiProperty() link!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional() description?: string;
  @ApiPropertyOptional() priceByn?: number;
  @ApiPropertyOptional() priceUsd?: number;
  @ApiPropertyOptional() address?: string;
  /** Land/plot area in sotki. */
  @ApiPropertyOptional() plotArea?: number;
  /** Seller/contact name. */
  @ApiPropertyOptional() seller?: string;
  /** ISO 8601 timestamp of last update on realt.by. */
  @ApiProperty() listTime!: string;
  @ApiProperty({ type: [String] }) images!: string[];
}

/** A listing whose price has changed since the last snapshot. */
export interface RealtPriceChange {
  listing: RealtListing;
  oldPriceByn?: number;
  oldPriceUsd?: number;
}

/** Result for a single feed (one search URL). */
export interface RealtFeedResult {
  feedName: string;
  /** Total distinct listings in the snapshot after this run. */
  total: number;
  newListings: RealtListing[];
  priceChanges: RealtPriceChange[];
  /** True if pagination was cut off at MAX_PAGES — there may be more unseen listings. */
  truncated: boolean;
}

/** Aggregated result across all configured feeds. */
export class RealtResult {
  @ApiProperty({ type: () => Object, isArray: true }) feeds!: RealtFeedResult[];
}

/**
 * Persisted snapshot entry — extends RealtListing with tracking timestamps.
 * Stored in ./data/realt_<feedKey>_all.json
 */
export interface RealtSnapshotEntry extends RealtListing {
  firstSeenAt: string;
  lastSeenAt: string;
}

/** Type guard for RealtSnapshotEntry — used when reading snapshot files from disk. */
export const isRealtSnapshotEntry = (item: unknown): item is RealtSnapshotEntry => {
  if (typeof item !== 'object' || item === null) return false;
  const e = item as Record<string, unknown>;
  return (
    typeof e.adId === 'number' &&
    typeof e.listTime === 'string' &&
    typeof e.firstSeenAt === 'string' &&
    typeof e.lastSeenAt === 'string'
  );
};
