import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** A single travel.kufar.by short-term rental listing (one apartment / hotel / house lot). */
export class KufarRentFlatListing {
  /** kufar `adId` — stable numeric identifier across runs and date ranges. */
  @ApiProperty() adId!: number;
  @ApiProperty() link!: string;
  @ApiProperty() title!: string;
  /** Price per night in BYN whole rubles. Undefined when the listing has no priced offer. */
  @ApiPropertyOptional() pricePerNightByn?: number;
  @ApiPropertyOptional() address?: string;
  @ApiPropertyOptional() rooms?: number;
  @ApiPropertyOptional() area?: number;
  @ApiPropertyOptional() personsMax?: number;
  /** Human-readable housing type — "Отель", "Квартира", "Дом", etc. */
  @ApiPropertyOptional() accommodationType?: string;
  @ApiPropertyOptional() isHotel?: boolean;
  @ApiPropertyOptional() isSuperhost?: boolean;
  @ApiPropertyOptional() rating?: number;
  @ApiPropertyOptional() ratingScoresCount?: number;
  /** ISO timestamp from kufar when the listing was published. */
  @ApiPropertyOptional() listTime?: string;
  @ApiProperty({ type: [String] }) images!: string[];
}

/** Result of one scrape cycle. */
export class KufarRentFlatResult {
  @ApiProperty() total!: number;
  @ApiProperty({ type: () => KufarRentFlatListing, isArray: true })
  newListings!: KufarRentFlatListing[];
  @ApiProperty() isBaseline!: boolean;
}

/**
 * Persisted snapshot entry — extends KufarRentFlatListing with tracking timestamps.
 * Stored in ./data/kufar_rent_flat_all.json
 */
export interface KufarRentFlatSnapshotEntry extends KufarRentFlatListing {
  firstSeenAt: string;
  lastSeenAt: string;
}

/** Type guard for KufarRentFlatSnapshotEntry — used when reading the snapshot file from disk. */
export const isKufarRentFlatSnapshotEntry = (item: unknown): item is KufarRentFlatSnapshotEntry => {
  if (typeof item !== 'object' || item === null) return false;
  const e = item as Record<string, unknown>;
  return (
    typeof e.adId === 'number' &&
    typeof e.link === 'string' &&
    typeof e.title === 'string' &&
    typeof e.firstSeenAt === 'string' &&
    typeof e.lastSeenAt === 'string'
  );
};
