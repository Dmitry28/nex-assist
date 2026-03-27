const MONTH_MAP: Record<string, string> = {
  января: '01',
  февраля: '02',
  марта: '03',
  апреля: '04',
  мая: '05',
  июня: '06',
  июля: '07',
  августа: '08',
  сентября: '09',
  октября: '10',
  ноября: '11',
  декабря: '12',
};

/**
 * Extracts a date in "ДД.ММ.ГГГГ" format from an auction date string for archive matching.
 * Supports two formats found in real data:
 *   - "Аукцион состоится 24.03.2026" → "24.03.2026"
 *   - "Аукцион состоится 24 марта 2026 в 12:00" → "24.03.2026"
 * Returns undefined if no recognisable date is found.
 */
export function parseDateFromAuctionDate(auctionDate: string | undefined): string | undefined {
  if (!auctionDate) return undefined;

  // Numeric format — most common in real data (e.g. "Аукцион состоится 24.03.2026")
  const numeric = auctionDate.match(/(\d{2}\.\d{2}\.\d{4})/);
  if (numeric) return numeric[1];

  // Russian month-name format (e.g. "24 марта 2026")
  const m = auctionDate.match(
    /(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(\d{4})/,
  );
  if (!m) return undefined;
  return `${m[1].padStart(2, '0')}.${MONTH_MAP[m[2]]}.${m[3]}`;
}

/**
 * Strips "руб." and whitespace so "19 370,61 руб." and "19 370,61" both become "19370,61".
 * Used to compare the stored listing price against the archive initial price.
 */
export function normalizePrice(price: string): string {
  return price
    .replace(/руб\.?/gi, '')
    .replace(/\s/g, '')
    .trim();
}
