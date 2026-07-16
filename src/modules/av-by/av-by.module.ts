import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import avByConfig from '../../config/av-by.config';
import { ScrapingModule } from '../../common/scraping/scraping.module';
import { TelegramModule } from '../telegram/telegram.module';
import { AvByController } from './av-by.controller';
import { AvByNotifierService } from './av-by-notifier.service';
import { AvByService } from './av-by.service';

@Module({
  imports: [ConfigModule.forFeature(avByConfig), ScrapingModule, TelegramModule],
  controllers: [AvByController],
  providers: [AvByService, AvByNotifierService],
})
export class AvByModule {}
