/**
 * Which parts of the catalogue are worth a message.
 *
 * Unlike bamper.by, where each feed URL already narrows the search to one part, idriver has no
 * part parameter in its URLs: a feed is the model's whole catalogue, ~3600 offers deep, and the
 * newest page is whatever the yards happened to upload — deflectors, floor mats, lambda probes.
 * The wanted parts are therefore selected here, matching the set the bamper.by module watches
 * for the same car: rear bumper, tailgate, windshield. That set is deliberately spelled out
 * twice — bamper.by narrows by URL, idriver by part name — because neither representation can
 * express the other; changing what the owner shops for means editing both.
 *
 * Matching is on the Russian part name from the card title rather than on the URL slug: the slug
 * spelling is the site's own transliteration and differs per part, while the title is the text
 * the seller sees and is stable. The patterns spell their character classes out — JavaScript's
 * `\b` and `\w` are ASCII-only and match nothing useful in Cyrillic.
 */
const WANTED_PARTS: RegExp[] = [
  // "Бампер задний", "Бампер задний в сборе". Deliberately not "заднего бампера": that is the
  // reinforcement bar, a bracket or a trim, not the bumper itself.
  /бампер\s+задний|задний\s+бампер/i,
  // "Крышка багажника", "Дверь багажника" — the same panel under two names. "Обшивка багажника"
  // is excluded by requiring крышка/дверь.
  /(?:крышка|дверь)\s+багажника/i,
  // "Лобовое стекло" / "Стекло лобовое (ветровое)".
  /лобово[а-яё]*\s+стекл|стекл[а-яё]*\s+лобово/i,
];

/** True when the part is one of the three the owner is actually shopping for. */
export const isWantedPart = (part: string): boolean => WANTED_PARTS.some(re => re.test(part));
