import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import idriverConfig from '../../config/idriver.config';
import { ScrapingModule } from '../../common/scraping/scraping.module';
import { TelegramModule } from '../telegram/telegram.module';
import { IdriverController } from './idriver.controller';
import { IdriverNotifierService } from './idriver-notifier.service';
import { IdriverParserService } from './idriver-parser.service';
import { IdriverService } from './idriver.service';

@Module({
  imports: [ConfigModule.forFeature(idriverConfig), ScrapingModule, TelegramModule],
  controllers: [IdriverController],
  providers: [IdriverService, IdriverParserService, IdriverNotifierService],
})
export class IdriverModule {}
