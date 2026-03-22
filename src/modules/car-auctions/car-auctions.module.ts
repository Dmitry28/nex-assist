import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import carAuctionsConfig from '../../config/car-auctions.config';
import { SnapshotService } from '../../common/snapshot.service';
import { TelegramModule } from '../telegram/telegram.module';
import { CarAuctionsController } from './car-auctions.controller';
import { CarAuctionsService } from './car-auctions.service';
import { BidCarsParserService } from './bid-cars-parser.service';
import { CarAuctionsNotifierService } from './car-auctions-notifier.service';

@Module({
  imports: [ConfigModule.forFeature(carAuctionsConfig), TelegramModule],
  controllers: [CarAuctionsController],
  providers: [
    CarAuctionsService,
    BidCarsParserService,
    CarAuctionsNotifierService,
    SnapshotService,
  ],
})
export class CarAuctionsModule {}
