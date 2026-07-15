import * as Joi from 'joi';
import {
  APP_DEFAULTS,
  AV_BY_DEFAULTS,
  BAMPER_DEFAULTS,
  BID_CARS_DEFAULTS,
  GHB_DEFAULTS,
  KUFAR_DEFAULTS,
  KUFAR_RENT_FLAT_DEFAULTS,
  KUFAR_RENT_LONG_DEFAULTS,
  LAND_AUCTIONS_DEFAULTS,
  MOSTY_JOBS_DEFAULTS,
  POGORANY_DEFAULTS,
  REALT_DEFAULTS,
} from './constants';

/**
 * Joi schema for environment variable validation.
 * Runs at startup — invalid or missing required vars will crash the app with a clear message.
 *
 * NOTE: allowUnknown:true lets other modules add their own env vars without conflicts.
 * NOTE: abortEarly:false reports all validation errors at once instead of stopping at the first.
 */
export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test', 'staging')
    .default(APP_DEFAULTS.NODE_ENV),
  PORT: Joi.number().default(APP_DEFAULTS.PORT),
  APP_NAME: Joi.string().default(APP_DEFAULTS.APP_NAME),
  CORS_ORIGIN: Joi.string().default(APP_DEFAULTS.CORS_ORIGIN),
  THROTTLE_TTL: Joi.number().default(APP_DEFAULTS.THROTTLE_TTL),
  THROTTLE_LIMIT: Joi.number().default(APP_DEFAULTS.THROTTLE_LIMIT),
  // Optional: if set, POST /run requires X-Api-Key header with this value
  API_KEY: Joi.string().optional(),

  // Telegram bot token — optional: if omitted, all modules run in dry-run mode
  TELEGRAM_TOKEN: Joi.string().optional(),

  // Land auctions module
  SCRAPE_URL: Joi.string().uri().default(LAND_AUCTIONS_DEFAULTS.SCRAPE_URL),
  SCRAPE_CRON: Joi.string().default(LAND_AUCTIONS_DEFAULTS.SCRAPE_CRON),
  TELEGRAM_LAND_AUCTIONS_CHAT_ID: Joi.string().optional(),

  // bid.cars module
  BID_CARS_SCRAPE_URL: Joi.string().uri().default(BID_CARS_DEFAULTS.SCRAPE_URL),
  BID_CARS_SCRAPE_CRON: Joi.string().default(BID_CARS_DEFAULTS.SCRAPE_CRON),
  TELEGRAM_BID_CARS_CHAT_ID: Joi.string().optional(),

  // av.by module — ScrapFly proxies the SafeLine-protected site
  SCRAPFLY_API_KEY: Joi.string().optional(),
  AV_BY_ATLAS_URL: Joi.string().uri().default(AV_BY_DEFAULTS.ATLAS_URL),
  AV_BY_ATLAS_CROSS_SPORT_URL: Joi.string().uri().default(AV_BY_DEFAULTS.ATLAS_CROSS_SPORT_URL),
  AV_BY_MIN_RUN_INTERVAL_HOURS: Joi.number().default(AV_BY_DEFAULTS.MIN_RUN_INTERVAL_HOURS),
  TELEGRAM_AV_BY_CHAT_ID: Joi.string().optional(),

  // Kufar module — each feed URL is optional; omit to disable that feed
  KUFAR_GARAGES_URL: Joi.string().uri().default(KUFAR_DEFAULTS.GARAGES_URL),
  KUFAR_LAND_URL: Joi.string().uri().default(KUFAR_DEFAULTS.LAND_URL),
  KUFAR_HOUSES_URL: Joi.string().uri().default(KUFAR_DEFAULTS.HOUSES_URL),
  KUFAR_SCRAPE_CRON: Joi.string().default(KUFAR_DEFAULTS.SCRAPE_CRON),
  TELEGRAM_KUFAR_CHAT_ID: Joi.string().optional(),

  // Kufar Rent Flat module — travel.kufar.by short-term rentals
  KUFAR_RENT_FLAT_URL: Joi.string().uri().default(KUFAR_RENT_FLAT_DEFAULTS.GRODNO_URL),
  KUFAR_RENT_FLAT_SCRAPE_CRON: Joi.string().default(KUFAR_RENT_FLAT_DEFAULTS.SCRAPE_CRON),
  TELEGRAM_KUFAR_RENT_FLAT_CHAT_ID: Joi.string().optional(),

  // Kufar Rent Long module — re.kufar.by long-term apartment rentals
  KUFAR_RENT_LONG_URL: Joi.string().uri().default(KUFAR_RENT_LONG_DEFAULTS.GRODNO_URL),
  KUFAR_RENT_LONG_SCRAPE_CRON: Joi.string().default(KUFAR_RENT_LONG_DEFAULTS.SCRAPE_CRON),
  TELEGRAM_KUFAR_RENT_LONG_CHAT_ID: Joi.string().optional(),

  // realt.by module — multi-feed: plots, garage, cottages, dachi
  REALT_PLOTS_URL: Joi.string().uri().default(REALT_DEFAULTS.PLOTS_URL),
  REALT_GARAGE_URL: Joi.string().uri().default(REALT_DEFAULTS.GARAGE_URL),
  REALT_COTTAGES_URL: Joi.string().uri().default(REALT_DEFAULTS.COTTAGES_URL),
  REALT_DACHI_URL: Joi.string().uri().default(REALT_DEFAULTS.DACHI_URL),
  REALT_SCRAPE_CRON: Joi.string().default(REALT_DEFAULTS.SCRAPE_CRON),
  TELEGRAM_REALT_CHAT_ID: Joi.string().optional(),

  // pogorany.by module — Tilda store with ЖК Погораны townhouse apartments
  POGORANY_STORE_API_URL: Joi.string().uri().default(POGORANY_DEFAULTS.STORE_API_URL),
  POGORANY_SCRAPE_CRON: Joi.string().default(POGORANY_DEFAULTS.SCRAPE_CRON),
  TELEGRAM_POGORANY_CHAT_ID: Joi.string().optional(),

  // mosty-jobs module — job vacancies in Мостовский район (gsz, rabota, joblab, kufar)
  MOSTY_JOBS_GSZ_URL: Joi.string().uri().default(MOSTY_JOBS_DEFAULTS.GSZ_SEARCH_URL),
  MOSTY_JOBS_RABOTA_URL: Joi.string().uri().default(MOSTY_JOBS_DEFAULTS.RABOTA_SEARCH_URL),
  MOSTY_JOBS_JOBLAB_URL: Joi.string().uri().default(MOSTY_JOBS_DEFAULTS.JOBLAB_RSS_URL),
  MOSTY_JOBS_KUFAR_URL: Joi.string().uri().default(MOSTY_JOBS_DEFAULTS.KUFAR_SEARCH_URL),
  MOSTY_JOBS_EVROOPT_URL: Joi.string().uri().default(MOSTY_JOBS_DEFAULTS.EVROOPT_API_URL),
  MOSTY_JOBS_CRB_URL: Joi.string().uri().default(MOSTY_JOBS_DEFAULTS.CRB_URL),
  MOSTY_JOBS_FAIRS_URL: Joi.string().uri().default(MOSTY_JOBS_DEFAULTS.FAIRS_URL),
  MOSTY_JOBS_SCRAPE_CRON: Joi.string().default(MOSTY_JOBS_DEFAULTS.SCRAPE_CRON),
  TELEGRAM_MOSTY_JOBS_CHAT_ID: Joi.string().optional(),

  // bamper.by module — VW Atlas Cross Sport rear bumper (Cloudflare, driven via Puppeteer)
  BAMPER_REAR_BUMPER_URL: Joi.string().uri().default(BAMPER_DEFAULTS.REAR_BUMPER_URL),
  BAMPER_TAILGATE_URL: Joi.string().uri().default(BAMPER_DEFAULTS.TAILGATE_URL),
  BAMPER_ATLAS_FRONT_BUMPER_URL: Joi.string().uri().default(BAMPER_DEFAULTS.ATLAS_FRONT_BUMPER_URL),
  BAMPER_ATLAS_HOOD_URL: Joi.string().uri().default(BAMPER_DEFAULTS.ATLAS_HOOD_URL),
  BAMPER_ATLAS_HEADLIGHT_LEFT_URL: Joi.string()
    .uri()
    .default(BAMPER_DEFAULTS.ATLAS_HEADLIGHT_LEFT_URL),
  BAMPER_ATLAS_RADIATOR_SUPPORT_URL: Joi.string()
    .uri()
    .default(BAMPER_DEFAULTS.ATLAS_RADIATOR_SUPPORT_URL),
  BAMPER_SCRAPE_CRON: Joi.string().default(BAMPER_DEFAULTS.SCRAPE_CRON),
  TELEGRAM_ATLAS_PARTS_CHAT_ID: Joi.string().optional(),

  // ghb.by module — ОАО «Гродножилстрой» Прейскурант РБ (new apartments / offices)
  GHB_PRICE_LIST_URL: Joi.string().uri().default(GHB_DEFAULTS.PRICE_LIST_URL),
  GHB_APARTMENTS_PAGE_URL: Joi.string().uri().default(GHB_DEFAULTS.APARTMENTS_PAGE_URL),
  GHB_SCRAPE_CRON: Joi.string().default(GHB_DEFAULTS.SCRAPE_CRON),
  TELEGRAM_GHB_CHAT_ID: Joi.string().optional(),
});
