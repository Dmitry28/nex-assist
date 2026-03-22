import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { BidCarsResult } from './dto/car-listing.dto';
import { BidCarsService } from './bid-cars.service';

@ApiTags('bid-cars')
@Controller('bid-cars')
export class BidCarsController {
  constructor(private readonly service: BidCarsService) {}

  /** POST /api/v1/bid-cars/run — trigger a scrape cycle immediately. */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('X-Api-Key')
  @ApiOperation({ summary: 'Trigger a scrape cycle immediately' })
  @ApiResponse({ status: 200, type: BidCarsResult })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 409, description: 'Scrape already in progress' })
  async run(): Promise<BidCarsResult> {
    return this.service.run();
  }
}
