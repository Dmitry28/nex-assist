import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { PogoranyResult } from './dto/pogorany-listing.dto';
import { PogoranyService } from './pogorany.service';

@ApiTags('pogorany')
@Controller('pogorany')
export class PogoranyController {
  constructor(private readonly service: PogoranyService) {}

  /** POST /api/v1/pogorany/run — trigger a scrape cycle immediately. */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('X-Api-Key')
  @ApiOperation({ summary: 'Trigger a pogorany.by scrape cycle immediately' })
  @ApiResponse({ status: 200, type: PogoranyResult })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 409, description: 'Scrape already in progress' })
  async run(): Promise<PogoranyResult> {
    return this.service.run();
  }
}
