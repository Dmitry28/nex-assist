import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import bidCarsConfig from '../../config/bid-cars.config';
import { ScrapingModule } from '../../common/scraping/scraping.module';
import { TelegramModule } from '../telegram/telegram.module';
import { BidCarsController } from './bid-cars.controller';
import { BidCarsService } from './bid-cars.service';
import { BidCarsParserService } from './bid-cars-parser.service';
import { BidCarsNotifierService } from './bid-cars-notifier.service';

@Module({
  imports: [ConfigModule.forFeature(bidCarsConfig), ScrapingModule, TelegramModule],
  controllers: [BidCarsController],
  providers: [BidCarsService, BidCarsParserService, BidCarsNotifierService],
})
export class BidCarsModule {}
