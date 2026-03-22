import { registerAs } from '@nestjs/config';

/** Defaults — avoids magic strings scattered across files. */
export const LAND_AUCTIONS_DEFAULTS = {
  SCRAPE_URL: 'https://gcn.by/zemelnye-uchastki/zemelnye-uchastki-v-sobstvennost/',
  /** Default cron: every day at 08:00 */
  SCRAPE_CRON: '0 8 * * *',
} as const;

/** Namespaced config — access via ConfigService.get('landAuctions.*'). */
export default registerAs('landAuctions', () => ({
  telegramToken: process.env.TELEGRAM_TOKEN ?? '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? '',
  scrapeUrl: process.env.SCRAPE_URL ?? LAND_AUCTIONS_DEFAULTS.SCRAPE_URL,
  scrapeCron: process.env.SCRAPE_CRON ?? LAND_AUCTIONS_DEFAULTS.SCRAPE_CRON,
}));
