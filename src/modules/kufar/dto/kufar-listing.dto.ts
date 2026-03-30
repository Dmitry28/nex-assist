import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** A single Kufar real-estate listing. */
export class KufarListing {
  /** Stable identifier — does not change when the ad is bumped. */
  @ApiProperty() adId!: number;
  @ApiProperty() link!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional() description?: string;
  /** Price in Belarusian rubles (kopecks removed — stored as integer BYN). */
  @ApiPropertyOptional() priceByn?: number;
  @ApiPropertyOptional() priceUsd?: number;
  @ApiPropertyOptional() address?: string;
  /** Total area in m² (garages/houses). */
  @ApiPropertyOptional() area?: number;
  /** Land/plot area in sotki (land plots and houses with land). */
  @ApiPropertyOptional() plotArea?: number;
  /** Number of rooms (houses). */
  @ApiPropertyOptional() rooms?: number;
  /** Year built (houses). */
  @ApiPropertyOptional() yearBuilt?: number;
  /** Seller/account name. */
  @ApiPropertyOptional() seller?: string;
  /** Human-readable property type (e.g. "Машиноместо", "Дача"). */
  @ApiPropertyOptional() propertyType?: string;
  /** Additional features: improvements, heating, water supply, etc. */
  @ApiPropertyOptional({ type: [String] }) features?: string[];
  /** ISO 8601 UTC timestamp of last update/bump. */
  @ApiProperty() listTime!: string;
  @ApiProperty({ type: [String] }) images!: string[];
}

/** A listing whose price has changed since the last snapshot. */
export interface KufarPriceChange {
  listing: KufarListing;
  oldPriceByn?: number;
  oldPriceUsd?: number;
}

/** Result for a single feed (one search URL). */
export interface KufarFeedResult {
  feedName: string;
  /** Total distinct listings in the snapshot after this run. */
  total: number;
  newListings: KufarListing[];
  priceChanges: KufarPriceChange[];
  /** True if pagination was cut off at MAX_PAGES — there may be more unseen listings. */
  truncated: boolean;
}

/** Aggregated result across all configured feeds. */
export class KufarResult {
  @ApiProperty({ type: () => Object, isArray: true }) feeds!: KufarFeedResult[];
}

/**
 * Persisted snapshot entry — extends KufarListing with tracking timestamps.
 * Stored in ./data/kufar_<feedKey>_all.json
 */
export interface KufarSnapshotEntry extends KufarListing {
  /** UTC ISO timestamp of first appearance in our scrapes. */
  firstSeenAt: string;
  /** UTC ISO timestamp of the most recent appearance in our scrapes. */
  lastSeenAt: string;
}

/** Type guard for KufarSnapshotEntry — used when reading snapshot files from disk. */
export const isKufarSnapshotEntry = (item: unknown): item is KufarSnapshotEntry => {
  if (typeof item !== 'object' || item === null) return false;
  const e = item as Record<string, unknown>;
  return (
    typeof e.adId === 'number' &&
    typeof e.listTime === 'string' &&
    typeof e.firstSeenAt === 'string' &&
    typeof e.lastSeenAt === 'string'
  );
};
