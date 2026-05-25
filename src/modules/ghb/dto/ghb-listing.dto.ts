import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Discriminator: ghb.by lists residential houses and office spaces in the same page. */
export type GhbItemType = 'apartment' | 'office';

/**
 * A single ghb.by construction object from the "Прейскурант РБ" price list.
 * Each item is one row in the outer table (one жилой дом / офисный объект).
 */
export class GhbListing {
  /** Normalized absolute URL — used as the unique key (apartment and office id namespaces could overlap). */
  @ApiProperty() url!: string;
  /** Numeric id from the URL path (informational; not unique across types). */
  @ApiProperty() id!: number;
  @ApiProperty() type!: GhbItemType;
  @ApiProperty() title!: string;
  /** Raw "Онлайн регистрация ..." / "Дата начала продаж ..." line, if published. Optional. */
  @ApiPropertyOptional() onlineRegistration?: string;
  /** Min price per m² in BYN extracted from the inner price table. Optional — not all rows have prices. */
  @ApiPropertyOptional() minPricePerM2Byn?: number;
  /** Max price per m² in BYN. Same as min if only one price cell exists. */
  @ApiPropertyOptional() maxPricePerM2Byn?: number;
}

/** Result of one scrape cycle. */
export class GhbResult {
  @ApiProperty() total!: number;
  @ApiProperty({ type: () => GhbListing, isArray: true }) newListings!: GhbListing[];
  @ApiProperty() isBaseline!: boolean;
}

/**
 * Persisted snapshot entry — extends GhbListing with tracking timestamps.
 * Stored in ./data/ghb_apartments_all.json
 */
export interface GhbSnapshotEntry extends GhbListing {
  firstSeenAt: string;
  lastSeenAt: string;
}

/** Type guard for GhbSnapshotEntry — used when reading the snapshot file from disk. */
export const isGhbSnapshotEntry = (item: unknown): item is GhbSnapshotEntry => {
  if (typeof item !== 'object' || item === null) return false;
  const e = item as Record<string, unknown>;
  return (
    typeof e.url === 'string' &&
    typeof e.id === 'number' &&
    (e.type === 'apartment' || e.type === 'office') &&
    typeof e.title === 'string' &&
    typeof e.firstSeenAt === 'string' &&
    typeof e.lastSeenAt === 'string'
  );
};
