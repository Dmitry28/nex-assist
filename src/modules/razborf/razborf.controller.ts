import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { RazborfResult } from './dto/razborf-listing.dto';
import { RazborfService } from './razborf.service';

@ApiTags('razborf')
@Controller('razborf')
export class RazborfController {
  constructor(private readonly service: RazborfService) {}

  /** POST /api/v1/razborf/run — trigger a scrape cycle immediately. */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('X-Api-Key')
  @ApiOperation({ summary: 'Trigger a razborf.by scrape cycle immediately' })
  @ApiResponse({ status: 200, type: RazborfResult })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 409, description: 'Scrape already in progress' })
  async run(): Promise<RazborfResult> {
    return this.service.run();
  }
}
