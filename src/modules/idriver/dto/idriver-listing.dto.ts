import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** A single idriver.by used-parts offer. */
export class IdriverListing {
  /** Stable id — the numeric offer id from the URL and the card's `Element<id>` class. */
  @ApiProperty() id!: string;
  @ApiProperty() url!: string;
  @ApiProperty() title!: string;
  /** Part name derived from the title, e.g. "Бампер задний" — the catalogue covers every part. */
  @ApiProperty() part!: string;
  /** Donor-car year parsed from the title (e.g. 2024). Undefined if not stated. */
  @ApiPropertyOptional() year?: number;
  /** Price in BYN. Undefined when the seller hides it. */
  @ApiPropertyOptional() priceByn?: number;
  @ApiPropertyOptional() city?: string;
  /**
   * Full-size card photo. Always a WebP URL — the site offers nothing else — and one that only
   * we can fetch, never Telegram: it is uploaded as bytes, not passed on as a link.
   */
  @ApiPropertyOptional() photoUrl?: string;
  /** Seller's free-text notes: condition, colour, origin, "оригинал из США", etc. */
  @ApiPropertyOptional() description?: string;
  /** Donor-car spec as shown on the card, e.g. "2.0TSI, Бензин, АКПП". */
  @ApiPropertyOptional() carSpec?: string;
  /** Breaker's yard / seller name. */
  @ApiPropertyOptional() seller?: string;
  /** Publication date as printed on the card, e.g. "18.10.2025". */
  @ApiPropertyOptional() publishedAt?: string;
}

/** Result for a single car catalogue within a scrape cycle. */
export class IdriverFeedResult {
  @ApiProperty() feedKey!: string;
  @ApiProperty() car!: string;
  /** The monitored catalogue URL — surfaced in the Telegram summary. */
  @ApiProperty() url!: string;
  /** Listings parsed from the page, before the year filter. */
  @ApiProperty() total!: number;
  /** Listings that passed the part and year filters — the ones worth notifying about. */
  @ApiProperty() matching!: number;
  @ApiProperty({ type: () => IdriverListing, isArray: true }) newListings!: IdriverListing[];
  @ApiProperty() isBaseline!: boolean;
  /**
   * True when every listing on the page was unseen, which means the page turned over completely
   * between runs and older arrivals may have fallen off it unnoticed.
   */
  @ApiProperty() mayHaveMissed!: boolean;
}

/** Result of one scrape cycle across all car catalogues. */
export class IdriverResult {
  @ApiProperty({ type: () => IdriverFeedResult, isArray: true }) feeds!: IdriverFeedResult[];
  /** Cars whose catalogue could not be fetched this run — named in the summary. */
  @ApiProperty({ type: String, isArray: true }) failedFeeds!: string[];
}

/**
 * Persisted snapshot entry — extends IdriverListing with tracking timestamps.
 * Stored per feed in ./data/idriver_<feedKey>_all.json
 */
export interface IdriverSnapshotEntry extends IdriverListing {
  firstSeenAt: string;
  lastSeenAt: string;
}

/** Type guard for IdriverSnapshotEntry — used when reading the snapshot file from disk. */
export const isIdriverSnapshotEntry = (item: unknown): item is IdriverSnapshotEntry => {
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
