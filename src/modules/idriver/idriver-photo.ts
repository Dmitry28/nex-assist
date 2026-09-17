import { Logger } from '@nestjs/common';
import { MAX_PHOTO_BYTES, PHOTO_TIMEOUT_MS } from './constants';

const logger = new Logger('IdriverPhoto');

/**
 * Downloads a card photo so it can be uploaded to Telegram as bytes.
 *
 * Telegram cannot fetch img*.idriver.by itself (sendPhoto by URL answers "failed to get HTTP URL
 * content"), but it accepts the same WebP file when it arrives as an upload — verified against
 * the live API. Anything that goes wrong here returns null and the caller sends text only: a
 * missing photo is worth far less than a missed listing.
 */
export const fetchPhoto = async (url: string): Promise<Buffer | null> => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS) });
    if (!response.ok) {
      logger.warn(`Photo ${url} — HTTP ${response.status}`);
      return null;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || buffer.length > MAX_PHOTO_BYTES) {
      logger.warn(`Photo ${url} — unusable size (${buffer.length} bytes)`);
      return null;
    }
    return buffer;
  } catch (error) {
    logger.warn(`Photo ${url} — ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
};
