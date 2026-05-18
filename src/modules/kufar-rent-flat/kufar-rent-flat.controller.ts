import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { KufarRentFlatResult } from './dto/kufar-rent-flat-listing.dto';
import { KufarRentFlatService } from './kufar-rent-flat.service';

@ApiTags('kufar-rent-flat')
@Controller('kufar-rent-flat')
export class KufarRentFlatController {
  constructor(private readonly service: KufarRentFlatService) {}

  /** POST /api/v1/kufar-rent-flat/run — trigger a scrape cycle immediately. */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('X-Api-Key')
  @ApiOperation({ summary: 'Trigger a travel.kufar.by scrape cycle immediately' })
  @ApiResponse({ status: 200, type: KufarRentFlatResult })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 409, description: 'Scrape already in progress' })
  async run(): Promise<KufarRentFlatResult> {
    return this.service.run();
  }
}
