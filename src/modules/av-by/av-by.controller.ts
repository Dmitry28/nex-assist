import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { AvByResult } from './dto/av-by-listing.dto';
import { AvByService } from './av-by.service';

@ApiTags('av-by')
@Controller('av-by')
export class AvByController {
  constructor(private readonly service: AvByService) {}

  /** POST /api/v1/av-by/run — trigger a scrape cycle (no-ops if cadence guard hasn't elapsed). */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('X-Api-Key')
  @ApiOperation({ summary: 'Trigger a scrape cycle (respects min-run-interval cadence guard)' })
  @ApiResponse({ status: 200, type: AvByResult })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 409, description: 'Scrape already in progress' })
  async run(): Promise<AvByResult> {
    return this.service.run();
  }
}
