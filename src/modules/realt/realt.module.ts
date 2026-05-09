import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import realtConfig from '../../config/realt.config';
import { TelegramModule } from '../telegram/telegram.module';
import { RealtController } from './realt.controller';
import { RealtNotifierService } from './realt-notifier.service';
import { RealtParserService } from './realt-parser.service';
import { RealtService } from './realt.service';

@Module({
  imports: [ConfigModule.forFeature(realtConfig), TelegramModule],
  controllers: [RealtController],
  providers: [RealtService, RealtParserService, RealtNotifierService],
})
export class RealtModule {}
