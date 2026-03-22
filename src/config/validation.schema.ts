import * as Joi from 'joi';
import { APP_DEFAULTS } from './constants';
import { LAND_AUCTIONS_DEFAULTS } from './land-auctions.config';

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

  // Telegram (shared across all modules that send notifications)
  TELEGRAM_TOKEN: Joi.string().required(),
  TELEGRAM_CHAT_ID: Joi.string().required(),

  // Land auctions module
  SCRAPE_URL: Joi.string().uri().default(LAND_AUCTIONS_DEFAULTS.SCRAPE_URL),
  SCRAPE_CRON: Joi.string().default(LAND_AUCTIONS_DEFAULTS.SCRAPE_CRON),
});
