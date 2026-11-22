import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import razborfConfig from '../../config/razborf.config';
import { ScrapingModule } from '../../common/scraping/scraping.module';
import { TelegramModule } from '../telegram/telegram.module';
import { RazborfController } from './razborf.controller';
import { RazborfNotifierService } from './razborf-notifier.service';
import { RazborfParserService } from './razborf-parser.service';
import { RazborfService } from './razborf.service';

@Module({
  imports: [ConfigModule.forFeature(razborfConfig), ScrapingModule, TelegramModule],
  controllers: [RazborfController],
  providers: [RazborfService, RazborfParserService, RazborfNotifierService],
})
export class RazborfModule {}
