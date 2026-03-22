import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import landAuctionsConfig from '../../config/land-auctions.config';
import { LandAuctionsController } from './land-auctions.controller';
import { LandAuctionsService } from './land-auctions.service';
import { GcnParserService } from './gcn-parser.service';
import { SnapshotService } from './snapshot.service';
import { TelegramService } from './telegram.service';

@Module({
  // forFeature registers the landAuctions namespace so ConfigService.get('landAuctions.*') resolves
  imports: [ConfigModule.forFeature(landAuctionsConfig)],
  controllers: [LandAuctionsController],
  providers: [LandAuctionsService, GcnParserService, SnapshotService, TelegramService],
})
export class LandAuctionsModule {}
