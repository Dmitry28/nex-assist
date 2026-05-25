import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import ghbConfig from '../../config/ghb.config';
import { TelegramModule } from '../telegram/telegram.module';
import { GhbController } from './ghb.controller';
import { GhbNotifierService } from './ghb-notifier.service';
import { GhbParserService } from './ghb-parser.service';
import { GhbService } from './ghb.service';

@Module({
  imports: [ConfigModule.forFeature(ghbConfig), TelegramModule],
  controllers: [GhbController],
  providers: [GhbService, GhbParserService, GhbNotifierService],
})
export class GhbModule {}
