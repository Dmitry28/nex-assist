/**
 * Default values for app configuration.
 *
 * Used in both app.config.ts (runtime fallbacks) and validation.schema.ts (Joi defaults)
 * to keep them in sync without duplication.
 */
export const LAND_AUCTIONS_DEFAULTS = {
  SCRAPE_URL: 'https://gcn.by/zemelnye-uchastki/zemelnye-uchastki-v-sobstvennost/',
  /** Default cron: every day at 08:00 UTC */
  SCRAPE_CRON: '0 8 * * *',
} as const;

export const KUFAR_DEFAULTS = {
  GARAGES_URL:
    'https://re.kufar.by/l/grodnenskaya-oblast/kupit/garazh?cur=BYR&gbx=b%3A23.725981746227706%2C53.57183301832253%2C23.94948485902068%2C53.75128104662766&size=30',
  LAND_URL:
    'https://re.kufar.by/l/grodnenskaya-oblast/kupit/uchastok?cur=BYR&gbx=b%3A23.63247006323345%2C53.454666565957595%2C24.079476288819368%2C53.81379430265694&size=30',
  HOUSES_URL:
    'https://re.kufar.by/l/grodnenskaya-oblast/kupit/dom?cur=BYR&gbx=b%3A23.656203109090203%2C53.45970346998098%2C24.10320933467615%2C53.81878831030225&size=30',
  /** Default cron: every day at 09:00 UTC (12:00 Minsk) */
  SCRAPE_CRON: '0 9 * * *',
} as const;

export const BID_CARS_DEFAULTS = {
  SCRAPE_URL:
    'https://bid.cars/ru/search/results?search-type=filters&status=Active&type=Automobile&make=Volkswagen&model=Atlas&year-from=2023&year-to=2027&auction-type=All&odometer-to=60000&start-code=Run+and+Drive&engine-size-to=2',
  /** Default cron: every day at 09:00 UTC */
  SCRAPE_CRON: '0 9 * * *',
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
