import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { BamperResult } from './dto/bamper-listing.dto';
import { BamperService } from './bamper.service';

@ApiTags('bamper')
@Controller('bamper')
export class BamperController {
  constructor(private readonly service: BamperService) {}

  /** POST /api/v1/bamper/run — trigger a scrape cycle immediately. */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('X-Api-Key')
  @ApiOperation({ summary: 'Trigger a bamper.by scrape cycle immediately' })
  @ApiResponse({ status: 200, type: BamperResult })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 409, description: 'Scrape already in progress' })
  async run(): Promise<BamperResult> {
    return this.service.run();
  }
}
