import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { LandAuctionsResult } from './dto/listing.dto';
import { LandAuctionsService } from './land-auctions.service';

/**
 * Exposes a manual trigger endpoint so the land auctions module can be run on demand
 * without waiting for the scheduled cron job.
 */
@Controller('land-auctions')
export class LandAuctionsController {
  constructor(private readonly service: LandAuctionsService) {}

  /** POST /api/v1/land-auctions/run — trigger a scrape cycle immediately. */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  async run(): Promise<LandAuctionsResult> {
    return this.service.run();
  }
}
