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

/** Result for a single part feed within a scrape cycle. */
export class BamperFeedResult {
  @ApiProperty() feedKey!: string;
  @ApiProperty() car!: string;
  @ApiProperty() label!: string;
  /** The monitored bamper.by search URL — surfaced in the Telegram summary. */
  @ApiProperty() url!: string;
  @ApiProperty() total!: number;
  @ApiProperty({ type: () => BamperListing, isArray: true }) newListings!: BamperListing[];
  @ApiProperty({ type: () => BamperListing, isArray: true }) removedListings!: BamperListing[];
  @ApiProperty() isBaseline!: boolean;
}

/** Result of one scrape cycle across all part feeds. */
export class BamperResult {
  @ApiProperty({ type: () => BamperFeedResult, isArray: true }) feeds!: BamperFeedResult[];
}

/**
 * Persisted snapshot entry — extends BamperListing with tracking timestamps.
 * Stored per feed in ./data/bamper_<feedKey>_all.json
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
