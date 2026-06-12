import type { Logger } from '@nestjs/common';
import { BROWSER_USER_AGENT } from '../../common/utils/scraping';
import { FETCH_TIMEOUT_MS, MAX_HTML_SIZE_BYTES } from './constants';

/**
 * Shared fetch helper for the module's plain-HTTPS sources (rabota, joblab,
 * kufar). Returns the response body, or null on any failure (logged).
 * The gsz parser can't use this — it needs a custom CA via https.get.
 */
export const fetchText = async (url: string, logger: Logger): Promise<string | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        'Accept-Language': 'ru-RU,ru;q=0.9',
      },
    });
    if (!res.ok) {
      logger.warn(`HTTP ${res.status} for ${url}`);
      return null;
    }
    const text = await res.text();
    if (text.length > MAX_HTML_SIZE_BYTES) {
      logger.warn(`Response too large (${text.length} bytes) for ${url}`);
      return null;
    }
    return text;
  } catch (err) {
    logger.error(`Failed to fetch ${url}`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
};
