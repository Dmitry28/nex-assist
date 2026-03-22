import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** A single car auction listing from bid.cars. */
export class CarListing {
  @ApiPropertyOptional() link?: string;
  @ApiPropertyOptional() title?: string;
  @ApiPropertyOptional() price?: string;
  @ApiPropertyOptional() odometer?: string;
  @ApiPropertyOptional() location?: string;
  @ApiPropertyOptional() image?: string;
}

/** Result returned from one full scrape cycle. */
export class BidCarsResult {
  @ApiProperty() total!: number;
  @ApiProperty({ type: [CarListing] }) newListings!: CarListing[];
  @ApiProperty({ type: [CarListing] }) removedListings!: CarListing[];
}
