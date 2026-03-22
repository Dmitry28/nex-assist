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
  @ApiPropertyOptional() engine?: string;
  @ApiPropertyOptional() location?: string;
  @ApiPropertyOptional() auctionDate?: string;
  @ApiPropertyOptional({ type: [String] }) images?: string[];
}

/** Result returned from one full scrape cycle. */
export class BidCarsResult {
  @ApiProperty() total!: number;
  @ApiProperty({ type: [CarListing] }) newListings!: CarListing[];
  @ApiProperty({ type: [CarListing] }) removedListings!: CarListing[];
}
