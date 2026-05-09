import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { RealtResult } from './dto/realt-listing.dto';
import { RealtService } from './realt.service';

@ApiTags('realt')
@Controller('realt')
export class RealtController {
  constructor(private readonly service: RealtService) {}

  /** POST /api/v1/realt/run — trigger a scrape cycle immediately. */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('X-Api-Key')
  @ApiOperation({ summary: 'Trigger a realt.by scrape cycle immediately' })
  @ApiResponse({ status: 200, type: RealtResult })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 409, description: 'Scrape already in progress' })
  async run(): Promise<RealtResult> {
    return this.service.run();
  }
}
