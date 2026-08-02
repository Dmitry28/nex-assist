import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { TownhousesResult } from './dto/townhouse-listing.dto';
import { TownhousesService } from './townhouses.service';

@ApiTags('townhouses')
@Controller('townhouses')
export class TownhousesController {
  constructor(private readonly service: TownhousesService) {}

  /** POST /api/v1/townhouses/run — trigger a scrape cycle immediately. */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('X-Api-Key')
  @ApiOperation({ summary: 'Trigger a Grodno townhouse scrape across all sources' })
  @ApiResponse({ status: 200, type: TownhousesResult })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 409, description: 'Scrape already in progress' })
  async run(): Promise<TownhousesResult> {
    return this.service.run();
  }
}
