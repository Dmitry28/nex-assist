import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** A single razborf.by used-part offer. */
export class RazborfListing {
  /** Stable id — the numeric offer id from the URL and the card's `prod<id>` element id. */
  @ApiProperty() id!: string;
  @ApiProperty() url!: string;
  @ApiProperty() title!: string;
  /** Category (part) name, e.g. "Бампер задний". */
  @ApiProperty() part!: string;
  @ApiPropertyOptional() year?: number;
  /** Price in BYN. Undefined when the seller hides it. */
  @ApiPropertyOptional() priceByn?: number;
  @ApiPropertyOptional() photoUrl?: string;
  /** Seller's free-text note: condition, origin, etc. */
  @ApiPropertyOptional() description?: string;
  /** Donor-car spec, e.g. "2.0 Бензин, АКПП". */
  @ApiPropertyOptional() carSpec?: string;
}

/** Result of one scrape cycle. */
export class RazborfResult {
  /** Listings found across all watched categories. */
  @ApiProperty() total!: number;
  /** Names of the watched categories that currently have stock. */
  @ApiProperty({ type: String, isArray: true }) categories!: string[];
  @ApiProperty({ type: () => RazborfListing, isArray: true }) newListings!: RazborfListing[];
  @ApiProperty() isBaseline!: boolean;
  /** Categories whose page could not be fetched this run. */
  @ApiProperty({ type: String, isArray: true }) failedCategories!: string[];
}

/** Persisted snapshot entry — a listing plus tracking timestamps. */
export interface RazborfSnapshotEntry extends RazborfListing {
  firstSeenAt: string;
  lastSeenAt: string;
}

/** Type guard for snapshot entries read from disk. */
export const isRazborfSnapshotEntry = (item: unknown): item is RazborfSnapshotEntry => {
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
