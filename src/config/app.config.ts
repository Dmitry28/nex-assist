import { registerAs } from '@nestjs/config';
import { APP_DEFAULTS } from './constants';

/** Namespaced app config — access via ConfigService.get('app.*'). */
export default registerAs('app', () => ({
  env: process.env.NODE_ENV ?? APP_DEFAULTS.NODE_ENV,
  port: parseInt(process.env.PORT ?? String(APP_DEFAULTS.PORT), 10),
  name: process.env.APP_NAME ?? APP_DEFAULTS.APP_NAME,
  corsOrigin: process.env.CORS_ORIGIN ?? APP_DEFAULTS.CORS_ORIGIN,
  throttleTtl: parseInt(process.env.THROTTLE_TTL ?? String(APP_DEFAULTS.THROTTLE_TTL), 10),
  throttleLimit: parseInt(process.env.THROTTLE_LIMIT ?? String(APP_DEFAULTS.THROTTLE_LIMIT), 10),
  // Optional API key for protecting sensitive endpoints (e.g. POST /run).
  // If not set, those endpoints are unprotected — acceptable in local/dry-run mode.
  apiKey: process.env.API_KEY,
}));
