import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import bamperConfig from '../../config/bamper.config';
import { TelegramModule } from '../telegram/telegram.module';
import { BamperController } from './bamper.controller';
import { BamperNotifierService } from './bamper-notifier.service';
import { BamperParserService } from './bamper-parser.service';
import { BamperService } from './bamper.service';

@Module({
  imports: [ConfigModule.forFeature(bamperConfig), TelegramModule],
  controllers: [BamperController],
  providers: [BamperService, BamperParserService, BamperNotifierService],
})
export class BamperModule {}
