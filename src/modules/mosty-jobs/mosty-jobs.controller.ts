import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { MostyJobsResult } from './dto/job-vacancy.dto';
import { MostyJobsService } from './mosty-jobs.service';

@ApiTags('mosty-jobs')
@Controller('mosty-jobs')
export class MostyJobsController {
  constructor(private readonly service: MostyJobsService) {}

  /** POST /api/v1/mosty-jobs/run — trigger a scrape cycle immediately. */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('X-Api-Key')
  @ApiOperation({ summary: 'Trigger a Мостовский район vacancies scrape cycle immediately' })
  @ApiResponse({ status: 200, type: MostyJobsResult })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  @ApiResponse({ status: 409, description: 'Scrape already in progress' })
  async run(): Promise<MostyJobsResult> {
    return this.service.run();
  }
}
