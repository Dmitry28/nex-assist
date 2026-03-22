import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** A single land auction listing from gcn.by. */
export class Listing {
  @ApiPropertyOptional() title?: string;
  @ApiPropertyOptional() link?: string;
  @ApiPropertyOptional() price?: string;
  @ApiPropertyOptional() area?: string;
  @ApiPropertyOptional() address?: string;
  @ApiPropertyOptional() cadastralNumber?: string;
  @ApiPropertyOptional() cadastralMapUrl?: string;
  @ApiPropertyOptional() auctionDate?: string;
  @ApiPropertyOptional() applicationDeadline?: string;
  @ApiPropertyOptional() communications?: string;
  @ApiPropertyOptional({ type: [String] }) images?: string[];
}

/** Full detail fields fetched from a listing's own page — internal use only. */
export interface ListingDetails {
  price: string;
  area: string;
  address: string;
  cadastralNumber: string;
  cadastralMapUrl: string;
  auctionDate: string;
  applicationDeadline: string;
  communications: string;
  images: string[];
}

/** Result returned from one full scrape cycle. */
export class LandAuctionsResult {
  @ApiProperty() total!: number;
  @ApiProperty({ type: [Listing] }) newListings!: Listing[];
  @ApiProperty({ type: [Listing] }) removedListings!: Listing[];
  /** All listings matching the special keyword (e.g. Заболоть area). */
  @ApiProperty({ type: [Listing] }) specialListings!: Listing[];
  @ApiProperty({ type: [Listing] }) newSpecialListings!: Listing[];
}
