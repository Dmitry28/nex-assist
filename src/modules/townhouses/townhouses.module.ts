import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import townhousesConfig from '../../config/townhouses.config';
import { KufarParserService } from '../kufar/kufar-parser.service';
import { RealtParserService } from '../realt/realt-parser.service';
import { TelegramModule } from '../telegram/telegram.module';
import { TownhousesController } from './townhouses.controller';
import { TownhousesNotifierService } from './townhouses-notifier.service';
import { TownhousesPrometrParserService } from './townhouses-prometr-parser.service';
import { TownhousesService } from './townhouses.service';

/**
 * The kufar and realt parsers are provided directly rather than imported from their modules:
 * they hold no module state, and re-declaring them here avoids exporting internals of two
 * unrelated modules just to reach a stateless fetcher.
 */
@Module({
  imports: [ConfigModule.forFeature(townhousesConfig), TelegramModule],
  controllers: [TownhousesController],
  providers: [
    TownhousesService,
    TownhousesPrometrParserService,
    TownhousesNotifierService,
    KufarParserService,
    RealtParserService,
  ],
})
export class TownhousesModule {}
