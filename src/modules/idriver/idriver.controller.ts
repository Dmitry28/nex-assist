import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { IdriverResult } from './dto/idriver-listing.dto';
import { IdriverService } from './idriver.service';

@ApiTags('idriver')
@Controller('idriver')
export class IdriverController {
  constructor(private readonly service: IdriverService) {}

  /** POST /api/v1/idriver/run — trigger a scrape cycle immediately. */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('X-Api-Key')
  @ApiOperation({ summary: 'Trigger an idriver.by scrape cycle immediately' })
  @ApiResponse({ status: 200, type: IdriverResult })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 409, description: 'Scrape already in progress' })
  async run(): Promise<IdriverResult> {
    return this.service.run();
  }
}
