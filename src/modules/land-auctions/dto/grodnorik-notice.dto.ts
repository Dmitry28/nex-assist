import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * One auction notice from grodnorik.gov.by.
 *
 * The райисполком publishes each auction as a single PDF/DOC file linked from one page —
 * there are no per-lot pages, so price, area and photos simply do not exist here.
 * The title carries the auction type and date; everything else is inside the document.
 */
export class GrodnorikNotice {
  /** Absolute URL of the notice file. Also the diff key. */
  @ApiProperty() link!: string;
  @ApiProperty() title!: string;
  /** Auction date parsed out of the title, as `ДД.ММ.ГГГГ`. Absent if the title has none. */
  @ApiPropertyOptional() auctionDate?: string;
}

/** Type guard: checks that an unknown value is a valid {@link GrodnorikNotice}. */
export const isGrodnorikNotice = (item: unknown): item is GrodnorikNotice =>
  typeof item === 'object' &&
  item !== null &&
  'link' in item &&
  typeof item.link === 'string' &&
  'title' in item &&
  typeof item.title === 'string';
