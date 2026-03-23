/** Telegram max caption length in characters. */
export const TELEGRAM_CAPTION_LIMIT = 1024;

/** Delay between Telegram sends to avoid rate limiting (ms). */
export const TELEGRAM_SEND_DELAY_MS = 1000;

export const truncateCaption = (text: string): string =>
  text.length <= TELEGRAM_CAPTION_LIMIT ? text : text.slice(0, TELEGRAM_CAPTION_LIMIT - 3) + '...';
