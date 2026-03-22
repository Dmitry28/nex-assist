import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { CarAuctionsResult } from './dto/car-listing.dto';
import { CarAuctionsService } from './car-auctions.service';

@ApiTags('car-auctions')
@Controller('car-auctions')
export class CarAuctionsController {
  constructor(private readonly service: CarAuctionsService) {}

  /** POST /api/v1/car-auctions/run — trigger a scrape cycle immediately. */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('X-Api-Key')
  @ApiOperation({ summary: 'Trigger a scrape cycle immediately' })
  @ApiResponse({ status: 200, type: CarAuctionsResult })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 409, description: 'Scrape already in progress' })
  async run(): Promise<CarAuctionsResult> {
    return this.service.run();
  }
}
