import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { LandAuctionsResult } from './dto/listing.dto';
import { LandAuctionsService } from './land-auctions.service';

/**
 * Exposes a manual trigger endpoint so the land auctions module can be run on demand
 * without waiting for the scheduled cron job.
 */
@ApiTags('land-auctions')
@Controller('land-auctions')
export class LandAuctionsController {
  constructor(private readonly service: LandAuctionsService) {}

  /** POST /api/v1/land-auctions/run — trigger a scrape cycle immediately. */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('X-Api-Key')
  @ApiOperation({ summary: 'Trigger a scrape cycle immediately' })
  @ApiResponse({ status: 200, type: LandAuctionsResult })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 409, description: 'Scrape already in progress' })
  async run(): Promise<LandAuctionsResult> {
    return this.service.run();
  }
}
