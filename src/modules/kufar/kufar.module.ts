import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import kufarConfig from '../../config/kufar.config';
import { ScrapingModule } from '../../common/scraping/scraping.module';
import { TelegramModule } from '../telegram/telegram.module';
import { KufarController } from './kufar.controller';
import { KufarService } from './kufar.service';
import { KufarParserService } from './kufar-parser.service';
import { KufarNotifierService } from './kufar-notifier.service';

@Module({
  imports: [ConfigModule.forFeature(kufarConfig), ScrapingModule, TelegramModule],
  controllers: [KufarController],
  providers: [KufarService, KufarParserService, KufarNotifierService],
})
export class KufarModule {}
