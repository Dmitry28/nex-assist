import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** A single car listing parsed from cars.av.by __NEXT_DATA__. */
export class AvByListing {
  @ApiProperty() id!: number;
  @ApiProperty() url!: string;
  @ApiProperty() title!: string;
  @ApiProperty() priceUsd!: number;
  @ApiProperty() priceByn!: number;
  @ApiPropertyOptional() brand?: string;
  @ApiPropertyOptional() model?: string;
  @ApiPropertyOptional() year?: number;
  @ApiPropertyOptional() mileageKm?: number;
  @ApiPropertyOptional() engineCapacity?: string;
  @ApiPropertyOptional() engineType?: string;
  @ApiPropertyOptional() transmission?: string;
  @ApiPropertyOptional() bodyType?: string;
  @ApiPropertyOptional() driveType?: string;
  @ApiPropertyOptional() color?: string;
  /** Partial VIN as shown by av.by (first 7 chars + asterisks). */
  @ApiPropertyOptional() vinPartial?: string;
  @ApiPropertyOptional() location?: string;
  @ApiPropertyOptional() sellerName?: string;
  @ApiPropertyOptional() publishedAt?: string;
  @ApiPropertyOptional() renewedAt?: string;
  @ApiPropertyOptional() photoUrl?: string;
}

/** Snapshot entry — listing + tracking timestamps. */
export interface AvBySnapshotEntry extends AvByListing {
  firstSeenAt: string;
  lastSeenAt: string;
}

/**
 * A listing that has left the active search results — assumed sold.
 * Final price = last observed price before disappearance.
 */
export interface RemovedAvByListing extends AvByListing {
  removedAt: string;
  /** ISO timestamp of when the Telegram "sold" notification was sent. */
  soldNotifiedAt?: string;
  /** First-seen timestamp from the snapshot, for "active for X days" stats. */
  firstSeenAt?: string;
}

/** Price-change record between two snapshots. */
export interface AvByPriceChange {
  listing: AvByListing;
  oldPriceUsd: number;
  oldPriceByn: number;
}

export const isAvByListing = (item: unknown): item is AvByListing =>
  typeof item === 'object' &&
  item !== null &&
  'id' in item &&
  typeof (item as { id: unknown }).id === 'number' &&
  'url' in item &&
  typeof (item as { url: unknown }).url === 'string';

export const isAvBySnapshotEntry = (item: unknown): item is AvBySnapshotEntry =>
  isAvByListing(item) &&
  typeof (item as unknown as Record<string, unknown>).firstSeenAt === 'string';

export const isRemovedAvByListing = (item: unknown): item is RemovedAvByListing =>
  isAvByListing(item) && typeof (item as unknown as Record<string, unknown>).removedAt === 'string';

/** Per-feed scrape result. */
export class AvByFeedResult {
  @ApiProperty() feedKey!: string;
  @ApiProperty() label!: string;
  @ApiProperty() total!: number;
  @ApiProperty({ type: [AvByListing] }) newListings!: AvByListing[];
  @ApiProperty({ type: [Object], isArray: true }) soldListings!: RemovedAvByListing[];
  @ApiProperty({ type: [Object], isArray: true }) priceChanges!: AvByPriceChange[];
  @ApiProperty() isBaseline!: boolean;
}

/** Result returned from one full scrape cycle (across all feeds). */
export class AvByResult {
  @ApiProperty({ type: [AvByFeedResult] }) feeds!: AvByFeedResult[];
  /** True when the cadence guard skipped the run. */
  @ApiProperty() skipped!: boolean;
  @ApiPropertyOptional() skipReason?: string;
}
