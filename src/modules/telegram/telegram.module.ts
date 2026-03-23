import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import telegramConfig from '../../config/telegram.config';
import { TelegramService } from './telegram.service';

/**
 * Shared Telegram module.
 * Import this module in any feature module that needs to send Telegram messages.
 *
 * @example
 * @Module({ imports: [TelegramModule] })
 * export class SomeFeatureModule {}
 */
@Module({
  imports: [ConfigModule.forFeature(telegramConfig)],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
