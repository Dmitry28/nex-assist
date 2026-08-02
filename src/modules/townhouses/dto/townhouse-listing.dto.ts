import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Where a townhouse listing came from. */
export type TownhouseSource = 'prometr' | 'kufar' | 'realt';

/**
 * One townhouse offer, normalised across every source.
 *
 * The sources disagree on almost everything — prometr sells unbuilt units by the square
 * metre in BYN, kufar and realt resell finished ones in BYN and USD — so only `uid`,
 * `link` and `title` are guaranteed.
 */
export class TownhouseListing {
  /**
   * Stable cross-source identifier, `"<source>:<native id>"`. Prefixed because a kufar ad id
   * and a prometr unit id can collide, and the snapshot is a single shared file.
   */
  @ApiProperty() uid!: string;
  @ApiProperty() source!: TownhouseSource;
  /** Development name — only the primary market (prometr) groups units this way. */
  @ApiPropertyOptional() complex?: string;
  @ApiProperty() link!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional() priceByn?: number;
  @ApiPropertyOptional() priceUsd?: number;
  @ApiPropertyOptional() pricePerM2Byn?: number;
  @ApiPropertyOptional() area?: number;
  @ApiPropertyOptional() plotArea?: number;
  @ApiPropertyOptional() rooms?: number;
  @ApiPropertyOptional() address?: string;
  /** Free text; searched for townhouse wording, never rendered as an address. */
  @ApiPropertyOptional() description?: string;
  @ApiProperty({ type: [String] }) images!: string[];
}

/** A listing whose price moved since the last snapshot. */
export interface TownhousePriceChange {
  listing: TownhouseListing;
  oldPriceByn?: number;
  oldPriceUsd?: number;
}

/** Per-source outcome, kept so the summary can show which source went quiet. */
export class TownhouseSourceResult {
  @ApiProperty() source!: string;
  @ApiProperty() total!: number;
  @ApiProperty() failed!: boolean;
}

/** Result of one scrape cycle. */
export class TownhousesResult {
  @ApiProperty() total!: number;
  @ApiProperty({ type: () => TownhouseListing, isArray: true }) newListings!: TownhouseListing[];
  @ApiProperty({ type: () => Object, isArray: true }) priceChanges!: TownhousePriceChange[];
  @ApiProperty({ type: () => TownhouseSourceResult, isArray: true })
  sources!: TownhouseSourceResult[];
  @ApiProperty() isBaseline!: boolean;
}

/** Persisted snapshot entry — stored in ./data/townhouses_all.json */
export interface TownhouseSnapshotEntry extends TownhouseListing {
  firstSeenAt: string;
  lastSeenAt: string;
}

/** Type guard used when reading the snapshot file from disk. */
export const isTownhouseSnapshotEntry = (item: unknown): item is TownhouseSnapshotEntry => {
  if (typeof item !== 'object' || item === null) return false;
  const e = item as Record<string, unknown>;
  return (
    typeof e.uid === 'string' &&
    typeof e.source === 'string' &&
    typeof e.link === 'string' &&
    typeof e.title === 'string' &&
    typeof e.firstSeenAt === 'string' &&
    typeof e.lastSeenAt === 'string'
  );
};
