import { registerAs } from '@nestjs/config';
import { RAZBORF_DEFAULTS } from './constants';

/**
 * Namespaced config — access via ConfigService.get('razborf.*').
 *
 * razborf.by is a third source for the Atlas parts (after bamper.by and idriver.by) and posts
 * to the same "Atlas parts" channel. A plain server-rendered site, no anti-bot, no geo-block.
 */
export default registerAs('razborf', () => ({
  modelUrl: process.env.RAZBORF_MODEL_URL ?? RAZBORF_DEFAULTS.MODEL_URL,
  scrapeCron: process.env.RAZBORF_SCRAPE_CRON ?? RAZBORF_DEFAULTS.SCRAPE_CRON,
  chatId: process.env.TELEGRAM_ATLAS_PARTS_CHAT_ID,
}));
