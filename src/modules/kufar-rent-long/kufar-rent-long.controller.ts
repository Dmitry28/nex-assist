import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { KufarRentLongResult } from './dto/kufar-rent-long-listing.dto';
import { KufarRentLongService } from './kufar-rent-long.service';

@ApiTags('kufar-rent-long')
@Controller('kufar-rent-long')
export class KufarRentLongController {
  constructor(private readonly service: KufarRentLongService) {}

  /** POST /api/v1/kufar-rent-long/run — trigger a scrape cycle immediately. */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('X-Api-Key')
  @ApiOperation({ summary: 'Trigger a re.kufar.by long-term rental scrape cycle immediately' })
  @ApiResponse({ status: 200, type: KufarRentLongResult })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 409, description: 'Scrape already in progress' })
  async run(): Promise<KufarRentLongResult> {
    return this.service.run();
  }
}
