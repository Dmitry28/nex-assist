import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import pogoranyConfig from '../../config/pogorany.config';
import { TelegramModule } from '../telegram/telegram.module';
import { PogoranyController } from './pogorany.controller';
import { PogoranyNotifierService } from './pogorany-notifier.service';
import { PogoranyParserService } from './pogorany-parser.service';
import { PogoranyService } from './pogorany.service';

@Module({
  imports: [ConfigModule.forFeature(pogoranyConfig), TelegramModule],
  controllers: [PogoranyController],
  providers: [PogoranyService, PogoranyParserService, PogoranyNotifierService],
})
export class PogoranyModule {}
