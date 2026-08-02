import { registerAs } from '@nestjs/config';
import { TOWNHOUSES_DEFAULTS } from './constants';

/** A development on prometr.by whose buildings are walked for units on sale. */
export interface TownhouseComplexConfig {
  key: string;
  /** Shown in Telegram and used to build unit titles. */
  name: string;
  url: string;
}

/**
 * Grodno townhouse developments on the primary market.
 *
 * ЖК Погораны is deliberately absent. The `pogorany` module already reads that developer's
 * own catalogue and notifies the same chat, so listing it here produced two messages for one
 * unit. Its catalogue is also the better source: 4 units against prometr's 2, with photos and
 * per-room detail prometr does not publish.
 */
function buildComplexes(): TownhouseComplexConfig[] {
  return [
    { key: 'belye-rosy', name: 'ЖК Белые Росы', url: TOWNHOUSES_DEFAULTS.PROMETR_BELYE_ROSY_URL },
    { key: 'royal-park', name: 'ЖК Роял Парк', url: TOWNHOUSES_DEFAULTS.PROMETR_ROYAL_PARK_URL },
  ];
}

/**
 * Namespaced config — access via ConfigService.get('townhouses.*').
 *
 * Notifications go to the pogorany chat on purpose: townhouses are one topic for the owner,
 * so everything about them lands in a single channel.
 */
export default registerAs('townhouses', () => ({
  complexes: buildComplexes(),
  kufarUrl: process.env.TOWNHOUSES_KUFAR_URL ?? TOWNHOUSES_DEFAULTS.KUFAR_URL,
  realtUrl: process.env.TOWNHOUSES_REALT_URL ?? TOWNHOUSES_DEFAULTS.REALT_URL,
  kufarFlatsUrl: process.env.TOWNHOUSES_KUFAR_FLATS_URL ?? TOWNHOUSES_DEFAULTS.KUFAR_FLATS_URL,
  realtFlatsUrl: process.env.TOWNHOUSES_REALT_FLATS_URL ?? TOWNHOUSES_DEFAULTS.REALT_FLATS_URL,
  chatId: process.env.TELEGRAM_POGORANY_CHAT_ID,
}));
