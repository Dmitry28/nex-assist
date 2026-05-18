import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** A single re.kufar.by long-term apartment rental listing. */
export class KufarRentLongListing {
  /** kufar `ad_id` — stable numeric identifier. */
  @ApiProperty() adId!: number;
  @ApiProperty() link!: string;
  @ApiProperty() title!: string;
  /** Monthly rent in BYN whole rubles (kufar stores 1/100 of the BYN). */
  @ApiPropertyOptional() priceByn?: number;
  /** Monthly rent in USD whole dollars (kufar stores 1/100). */
  @ApiPropertyOptional() priceUsd?: number;
  @ApiPropertyOptional() address?: string;
  @ApiPropertyOptional() rooms?: number;
  /** Total area, m². */
  @ApiPropertyOptional() area?: number;
  @ApiPropertyOptional() floor?: number;
  @ApiPropertyOptional() totalFloors?: number;
  @ApiPropertyOptional() repair?: string;
  @ApiPropertyOptional() furnished?: string;
  @ApiPropertyOptional() prepayment?: string;
  /** ISO timestamp from kufar when the listing was published. */
  @ApiPropertyOptional() listTime?: string;
  @ApiProperty({ type: [String] }) images!: string[];
}

/** Result of one scrape cycle. */
export class KufarRentLongResult {
  @ApiProperty() total!: number;
  @ApiProperty({ type: () => KufarRentLongListing, isArray: true })
  newListings!: KufarRentLongListing[];
  @ApiProperty() isBaseline!: boolean;
}

/**
 * Persisted snapshot entry — extends KufarRentLongListing with tracking timestamps.
 * Stored in ./data/kufar_rent_long_all.json
 */
export interface KufarRentLongSnapshotEntry extends KufarRentLongListing {
  firstSeenAt: string;
  lastSeenAt: string;
}

/** Type guard for KufarRentLongSnapshotEntry — used when reading the snapshot file from disk. */
export const isKufarRentLongSnapshotEntry = (item: unknown): item is KufarRentLongSnapshotEntry => {
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
