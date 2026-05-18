import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import kufarRentFlatConfig from '../../config/kufar-rent-flat.config';
import { TelegramModule } from '../telegram/telegram.module';
import { KufarRentFlatController } from './kufar-rent-flat.controller';
import { KufarRentFlatNotifierService } from './kufar-rent-flat-notifier.service';
import { KufarRentFlatParserService } from './kufar-rent-flat-parser.service';
import { KufarRentFlatService } from './kufar-rent-flat.service';

@Module({
  imports: [ConfigModule.forFeature(kufarRentFlatConfig), TelegramModule],
  controllers: [KufarRentFlatController],
  providers: [KufarRentFlatService, KufarRentFlatParserService, KufarRentFlatNotifierService],
})
export class KufarRentFlatModule {}
