import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** A single pogorany.by Tilda store product (one townhouse apartment lot). */
export class PogoranyListing {
  /** Tilda product `uid` — stable numeric identifier. */
  @ApiProperty() uid!: number;
  @ApiProperty() link!: string;
  @ApiProperty() title!: string;
  /** Total price as a number in the source currency. Undefined if no price set on the edition. */
  @ApiPropertyOptional() price?: number;
  @ApiPropertyOptional() currency?: string;
  /** Price per square meter (number) and its currency, if published. */
  @ApiPropertyOptional() pricePerM2?: number;
  @ApiPropertyOptional() pricePerM2Currency?: string;
  @ApiPropertyOptional() area?: string;
  @ApiPropertyOptional() rooms?: string;
  @ApiPropertyOptional() bathrooms?: string;
  @ApiPropertyOptional() ceilingHeight?: string;
  @ApiPropertyOptional() plotArea?: string;
  @ApiPropertyOptional() parking?: string;
  @ApiProperty({ type: [String] }) images!: string[];
}

/** A listing whose price has changed since the last snapshot. */
export interface PogoranyPriceChange {
  listing: PogoranyListing;
  oldPrice?: number;
  oldCurrency?: string;
}

/** Result of one scrape cycle. */
export class PogoranyResult {
  @ApiProperty() total!: number;
  @ApiProperty({ type: () => PogoranyListing, isArray: true }) newListings!: PogoranyListing[];
  @ApiProperty({ type: () => PogoranyListing, isArray: true }) removedListings!: PogoranyListing[];
  @ApiProperty({ type: () => Object, isArray: true }) priceChanges!: PogoranyPriceChange[];
  @ApiProperty() isBaseline!: boolean;
}

/**
 * Persisted snapshot entry — extends PogoranyListing with tracking timestamps.
 * Stored in ./data/pogorany_all.json
 */
export interface PogoranySnapshotEntry extends PogoranyListing {
  firstSeenAt: string;
  lastSeenAt: string;
}

/** Type guard for PogoranySnapshotEntry — used when reading the snapshot file from disk. */
export const isPogoranySnapshotEntry = (item: unknown): item is PogoranySnapshotEntry => {
  if (typeof item !== 'object' || item === null) return false;
  const e = item as Record<string, unknown>;
  return (
    typeof e.uid === 'number' &&
    typeof e.link === 'string' &&
    typeof e.title === 'string' &&
    typeof e.firstSeenAt === 'string' &&
    typeof e.lastSeenAt === 'string'
  );
};
