import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import mostyJobsConfig from '../../config/mosty-jobs.config';
import { TelegramModule } from '../telegram/telegram.module';
import { GszParserService } from './gsz-parser.service';
import { MostyJobsController } from './mosty-jobs.controller';
import { MostyJobsNotifierService } from './mosty-jobs-notifier.service';
import { MostyJobsService } from './mosty-jobs.service';
import { RabotaParserService } from './rabota-parser.service';

@Module({
  imports: [ConfigModule.forFeature(mostyJobsConfig), TelegramModule],
  controllers: [MostyJobsController],
  providers: [MostyJobsService, GszParserService, RabotaParserService, MostyJobsNotifierService],
})
export class MostyJobsModule {}
