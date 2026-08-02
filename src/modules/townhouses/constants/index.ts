/** Origin used to absolutise the relative links prometr.by emits. */
export const PROMETR_ORIGIN = 'https://prometr.by';

/** HTTP request timeout (ms). */
export const FETCH_TIMEOUT_MS = 30_000;

/** Max HTML response size — prometr pages run ~450 KB, so 5 MB is generous. */
export const MAX_HTML_SIZE_BYTES = 5 * 1024 * 1024;

/** Max wall-clock time for a full scrape cycle — watchdog resets isRunning if exceeded. */
export const RUN_TIMEOUT_MS = 15 * 60 * 1000;

/** Pause between consecutive page fetches, matching the politeness of the other modules. */
export const INTER_PAGE_DELAY_MS = 1_000;

/** Pause between whole sources. */
export const INTER_SOURCE_DELAY_MS = 2_000;

/**
 * Safety cap on building pages fetched per complex. Погораны is the largest at 5; the cap
 * only exists so a markup change that makes every link look like a building cannot spin.
 */
export const MAX_BUILDINGS_PER_COMPLEX = 20;

/** Snapshot file — one shared file, since `uid` is namespaced by source. */
export const DATA_FILE = './data/townhouses_all.json';

/** Telegram notification section headers. */
export const NOTIFICATION_HEADERS = {
  new: '🆕 Новый таунхаус',
  priceChange: '💸 Изменение цены',
} as const;

/** Human-readable source names for Telegram. */
export const SOURCE_DISPLAY_NAMES: Record<string, string> = {
  prometr: 'Застройщики (prometr.by)',
  kufar: 'Kufar',
  realt: 'Realt',
  'kufar-flats': 'Kufar (в квартирах)',
  'realt-flats': 'Realt (в квартирах)',
};

/** Max price-change rows shown inline in the run summary. */
export const MAX_PRICE_CHANGES_IN_SUMMARY = 8;
