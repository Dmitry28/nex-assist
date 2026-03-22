import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import landAuctionsConfig from '../../config/land-auctions.config';
import { SnapshotService } from '../../common/snapshot.service';
import { TelegramModule } from '../telegram/telegram.module';
import { LandAuctionsController } from './land-auctions.controller';
import { LandAuctionsService } from './land-auctions.service';
import { GcnParserService } from './gcn-parser.service';
import { ListingNotifierService } from './listing-notifier.service';

@Module({
  imports: [ConfigModule.forFeature(landAuctionsConfig), TelegramModule],
  controllers: [LandAuctionsController],
  providers: [LandAuctionsService, GcnParserService, ListingNotifierService, SnapshotService],
})
export class LandAuctionsModule {}
