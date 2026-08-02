/**
 * Keyword matching for feeds that watch a category too broad to notify on wholesale.
 *
 * Townhouses have no category of their own on either site. Most are filed as houses
 * (kufar `dom`, realt `cottages`) and are covered by those feeds, but a minority are sold
 * as flats — "квартира в блокированном доме". Watching the flats category unfiltered would
 * mean hundreds of ordinary apartments for a handful of townhouses, so those feeds carry a
 * keyword list and only matching listings are diffed.
 */

/** Case-insensitive substring match against any of the keywords. */
export const matchesKeywords = (text: string, keywords: string[]): boolean => {
  const haystack = text.toLowerCase();
  return keywords.some(k => haystack.includes(k.toLowerCase()));
};

/**
 * Terms Grodno sellers use for a townhouse unit. "блокирован" covers the legal wording
 * ("блокированный жилой дом") that most flats-category townhouses are advertised under —
 * it is the only phrasing shared by every example found in the zone.
 */
export const TOWNHOUSE_KEYWORDS = [
  'таунхаус',
  'таун-хаус',
  'таун хаус',
  'townhouse',
  'блокирован',
  'квадрохаус',
];

/**
 * Keeps only listings matching one of `keywords`. A feed with no keywords is unfiltered,
 * so this is a no-op for every ordinary feed.
 */
export const filterByKeywords = <T>(
  listings: T[],
  keywords: string[] | undefined,
  toText: (listing: T) => string,
): T[] =>
  keywords === undefined ? listings : listings.filter(l => matchesKeywords(toText(l), keywords));
