/**
 * Default values for app configuration.
 *
 * Used in both app.config.ts (runtime fallbacks) and validation.schema.ts (Joi defaults)
 * to keep them in sync without duplication.
 */
export const LAND_AUCTIONS_DEFAULTS = {
  SCRAPE_URL: 'https://gcn.by/zemelnye-uchastki/zemelnye-uchastki-v-sobstvennost/',
  /** Default cron: every day at 08:00 */
  SCRAPE_CRON: '0 8 * * *',
} as const;

export const APP_DEFAULTS = {
  NODE_ENV: 'development',
  PORT: 3000,
  APP_NAME: 'land-scraper',
  /** Allow all origins by default. Override in production via CORS_ORIGIN env var. */
  CORS_ORIGIN: '*',
  /** Rate limiter window in milliseconds (60 seconds). */
  THROTTLE_TTL: 60_000,
  /** Maximum requests per window per IP. */
  THROTTLE_LIMIT: 100,
} as const;
