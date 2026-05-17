import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import avByConfig from '../../config/av-by.config';
import { TelegramModule } from '../telegram/telegram.module';
import { AvByController } from './av-by.controller';
import { AvByNotifierService } from './av-by-notifier.service';
import { AvByService } from './av-by.service';

@Module({
  imports: [ConfigModule.forFeature(avByConfig), TelegramModule],
  controllers: [AvByController],
  providers: [AvByService, AvByNotifierService],
})
export class AvByModule {}
