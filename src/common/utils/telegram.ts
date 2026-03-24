/** Telegram max caption length (photo/media group) in characters. */
export const TELEGRAM_CAPTION_LIMIT = 1024;

/** Telegram max text message length in characters. */
export const TELEGRAM_MESSAGE_LIMIT = 4096;

/** Telegram max items per media group (sendMediaGroup). */
export const TELEGRAM_MEDIA_GROUP_LIMIT = 10;

/** Delay between Telegram sends to avoid rate limiting (ms). */
export const TELEGRAM_SEND_DELAY_MS = 1000;

export const truncateText = (text: string, limit = TELEGRAM_CAPTION_LIMIT): string =>
  text.length <= limit ? text : text.slice(0, limit - 3) + '...';
