import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { GhbResult } from './dto/ghb-listing.dto';
import { GhbService } from './ghb.service';

@ApiTags('ghb')
@Controller('ghb')
export class GhbController {
  constructor(private readonly service: GhbService) {}

  /** POST /api/v1/ghb/run — trigger a scrape cycle immediately. */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('X-Api-Key')
  @ApiOperation({ summary: 'Trigger a ghb.by scrape cycle immediately' })
  @ApiResponse({ status: 200, type: GhbResult })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 409, description: 'Scrape already in progress' })
  async run(): Promise<GhbResult> {
    return this.service.run();
  }
}
