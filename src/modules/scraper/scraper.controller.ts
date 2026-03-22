import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { ScraperResult } from './dto/item.dto';
import { ScraperRunnerService } from './scraper-runner.service';

/**
 * Exposes a manual trigger endpoint so the scraper can be run on demand
 * without waiting for the scheduled cron job.
 */
@Controller('scraper')
export class ScraperController {
  constructor(private readonly runner: ScraperRunnerService) {}

  /** POST /api/v1/scraper/run — trigger a scrape cycle immediately. */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  async run(): Promise<ScraperResult> {
    return this.runner.run();
  }
}
