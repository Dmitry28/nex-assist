/**
 * Seller-initiated price-change detection for listings quoted in two currencies.
 *
 * Shared by the kufar, realt, av-by and townhouses modules — each stores a BYN and a USD
 * figure per listing, and both are conversions of one base price the site does not expose.
 */

/**
 * Minimum relative move (percent) for a change to count — in BOTH currencies when the listing
 * carries two, in the only comparable one otherwise.
 *
 * Sized against measured exchange-rate drift: between two daily runs the BYN/USD rate moves
 * well under 1 %, so a real edit of >= 2 % is never masked, and drift never reaches it.
 * Deliberate consequence: price tweaks below 2 % are treated as noise and not reported.
 */
export const MIN_PRICE_CHANGE_PERCENT = 2;

/** Treat 0 and undefined as equivalent "no price" to avoid false change detections. */
export const effectivePrice = (p: number | undefined): number | undefined =>
  p !== undefined && p > 0 ? p : undefined;

/** The two currency figures a listing carries. */
export interface DualCurrencyPrice {
  priceByn?: number;
  priceUsd?: number;
}

/** Relative move between two positive prices, in percent (signed). */
const movePercent = (prev: number, current: number): number => ((current - prev) / prev) * 100;

/**
 * True when the seller actually changed the price, as opposed to the exchange rate moving.
 *
 * Both figures are conversions of one base price, so a seller edit scales them by the same
 * factor — same direction, similar magnitude. Exchange-rate drift instead moves them by
 * different amounts and frequently in opposite directions. Measured over a 17-day gap, the
 * naive "both figures moved" rule flagged 34 kufar and 16 realt listings, of which 13 and 6
 * were pure drift — including pairs of unrelated listings sharing an identical -2.58 % / +0.69 %
 * signature, which only a rate change can produce.
 *
 * Listings priced in BYN or USD are already handled by requiring both figures to move (the
 * base-currency figure stays put under drift). The direction and magnitude checks catch the
 * remaining case: listings the seller quoted in a third currency, where drift moves both.
 */
export const hasPriceChanged = (prev: DualCurrencyPrice, current: DualCurrencyPrice): boolean => {
  const prevByn = effectivePrice(prev.priceByn);
  const prevUsd = effectivePrice(prev.priceUsd);
  const currentByn = effectivePrice(current.priceByn);
  const currentUsd = effectivePrice(current.priceUsd);

  const bynComparable = prevByn !== undefined && currentByn !== undefined;
  const usdComparable = prevUsd !== undefined && currentUsd !== undefined;

  if (bynComparable && usdComparable) {
    const bynPercent = movePercent(prevByn, currentByn);
    const usdPercent = movePercent(prevUsd, currentUsd);
    const sameDirection = bynPercent > 0 === usdPercent > 0;

    return (
      sameDirection &&
      Math.abs(bynPercent) >= MIN_PRICE_CHANGE_PERCENT &&
      Math.abs(usdPercent) >= MIN_PRICE_CHANGE_PERCENT
    );
  }

  // One comparable figure only (prometr quotes BYN, some kufar/realt ads quote a single
  // currency): there is no second figure to cross-check, so the direction test is unavailable —
  // but the magnitude floor still applies. The single figure is not drift-free: prometr's BYN
  // price is a daily conversion of a base price the site never publishes, so it wobbled ~0.08 %
  // between runs (521 591 → 522 004 BYN on the same untouched unit) and reported a price change
  // every single day.
  if (bynComparable) return Math.abs(movePercent(prevByn, currentByn)) >= MIN_PRICE_CHANGE_PERCENT;
  if (usdComparable) return Math.abs(movePercent(prevUsd, currentUsd)) >= MIN_PRICE_CHANGE_PERCENT;

  // Nothing comparable: a price appearing or disappearing has no percentage to compare — fall
  // back to the plain "both figures differ" test so "договорная" → priced is still reported.
  return prevByn !== currentByn && prevUsd !== currentUsd;
};
