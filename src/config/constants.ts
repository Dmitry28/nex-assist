/**
 * Default values for app configuration.
 *
 * Used in both app.config.ts (runtime fallbacks) and validation.schema.ts (Joi defaults)
 * to keep them in sync without duplication.
 */
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
