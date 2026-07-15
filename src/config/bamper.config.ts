import { registerAs } from '@nestjs/config';
import { BAMPER_DEFAULTS } from './constants';

/**
 * Namespaced config — access via ConfigService.get('bamper.*').
 *
 * bamper.by is behind Cloudflare; the parser uses Puppeteer (rebrowser-puppeteer)
 * to solve the challenge, so there is no API key — only the search URL and chat.
 */
export default registerAs('bamper', () => ({
  searchUrl: process.env.BAMPER_SEARCH_URL ?? BAMPER_DEFAULTS.SEARCH_URL,
  scrapeCron: process.env.BAMPER_SCRAPE_CRON ?? BAMPER_DEFAULTS.SCRAPE_CRON,
  chatId: process.env.TELEGRAM_BAMPER_CHAT_ID,
}));
