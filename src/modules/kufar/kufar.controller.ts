import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { KufarResult } from './dto/kufar-listing.dto';
import { KufarService } from './kufar.service';

@ApiTags('kufar')
@Controller('kufar')
export class KufarController {
  constructor(private readonly service: KufarService) {}

  /** POST /api/v1/kufar/run — trigger a scrape cycle immediately. */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('X-Api-Key')
  @ApiOperation({ summary: 'Trigger a Kufar scrape cycle immediately' })
  @ApiResponse({ status: 200, type: KufarResult })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 409, description: 'Scrape already in progress' })
  async run(): Promise<KufarResult> {
    return this.service.run();
  }
}
