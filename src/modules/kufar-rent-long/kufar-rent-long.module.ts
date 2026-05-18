import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import kufarRentLongConfig from '../../config/kufar-rent-long.config';
import { TelegramModule } from '../telegram/telegram.module';
import { KufarRentLongController } from './kufar-rent-long.controller';
import { KufarRentLongNotifierService } from './kufar-rent-long-notifier.service';
import { KufarRentLongParserService } from './kufar-rent-long-parser.service';
import { KufarRentLongService } from './kufar-rent-long.service';

@Module({
  imports: [ConfigModule.forFeature(kufarRentLongConfig), TelegramModule],
  controllers: [KufarRentLongController],
  providers: [KufarRentLongService, KufarRentLongParserService, KufarRentLongNotifierService],
})
export class KufarRentLongModule {}
