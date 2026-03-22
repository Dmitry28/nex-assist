import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import scraperConfig from '../../config/scraper.config';
import { ScraperController } from './scraper.controller';
import { ScraperRunnerService } from './scraper-runner.service';
import { ScraperService } from './scraper.service';
import { StorageService } from './storage.service';
import { TelegramService } from './telegram.service';

@Module({
  // forFeature registers the scraper namespace so ConfigService.get('scraper.*') resolves correctly
  imports: [ConfigModule.forFeature(scraperConfig)],
  controllers: [ScraperController],
  providers: [ScraperRunnerService, ScraperService, StorageService, TelegramService],
})
export class ScraperModule {}
