import { registerAs } from '@nestjs/config';

/** Scraper defaults — avoids magic strings scattered across files. */
export const SCRAPER_DEFAULTS = {
  SCRAPE_URL: 'https://gcn.by/zemelnye-uchastki/zemelnye-uchastki-v-sobstvennost/',
  /** Default cron: every day at 08:00 */
  SCRAPE_CRON: '0 8 * * *',
} as const;

/** Namespaced scraper config — access via ConfigService.get('scraper.*'). */
export default registerAs('scraper', () => ({
  telegramToken: process.env.TELEGRAM_TOKEN ?? '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? '',
  scrapeUrl: process.env.SCRAPE_URL ?? SCRAPER_DEFAULTS.SCRAPE_URL,
  scrapeCron: process.env.SCRAPE_CRON ?? SCRAPER_DEFAULTS.SCRAPE_CRON,
}));
