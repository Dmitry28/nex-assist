import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** A single car auction listing from bid.cars. */
export class CarListing {
  @ApiProperty() link!: string;
  @ApiPropertyOptional() title?: string;
  @ApiPropertyOptional() vin?: string;
  @ApiPropertyOptional() lot?: string;
  @ApiPropertyOptional() currentBid?: string;
  @ApiPropertyOptional() buyNow?: string;
  @ApiPropertyOptional() odometer?: string;
  @ApiPropertyOptional() damage?: string;
  @ApiPropertyOptional() keys?: string;
  @ApiPropertyOptional() condition?: string;
  @ApiPropertyOptional() engine?: string;
  @ApiPropertyOptional() location?: string;
  @ApiPropertyOptional() auctionDate?: string;
  @ApiPropertyOptional() auctionSource?: string;
  @ApiPropertyOptional() seller?: string;
  @ApiPropertyOptional({ type: [String] }) images?: string[];
}

/**
 * A listing that has left the active search results.
 * Extends CarListing with tracking timestamps and final sale price.
 * Persisted in bid_cars_removed.json for statistics.
 */
export interface RemovedCarListing extends CarListing {
  /** ISO timestamp of first detection as removed. */
  removedAt: string;
  /** ISO timestamp of when the removal Telegram notification was sent. */
  removalNotifiedAt?: string;
  /** Final sale price from Ended/Archived search results. */
  soldPrice?: string;
  /** ISO timestamp of when the sold-price Telegram notification was sent. */
  soldNotifiedAt?: string;
}

/** Result returned from one full scrape cycle. */
export class BidCarsResult {
  @ApiProperty() total!: number;
  @ApiProperty({ type: [CarListing] }) newListings!: CarListing[];
  /** Listings removed this run — notified with sold price if already found, otherwise without. */
  @ApiProperty({ type: [Object], isArray: true }) removedListings!: RemovedCarListing[];
  /** Previously-removed listings whose sold price was just found — triggers follow-up notification. */
  @ApiProperty({ type: [Object], isArray: true }) soldPriceUpdates!: RemovedCarListing[];
}
