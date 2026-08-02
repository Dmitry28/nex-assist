/**
 * Seller-initiated price-change detection for listings quoted in two currencies.
 *
 * Shared by the kufar, realt, av-by and townhouses modules — each stores a BYN and a USD
 * figure per listing, and both are conversions of one base price the site does not expose.
 */

/**
 * Minimum relative move (percent) in BOTH currencies for a change to count.
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

  if (
    prevByn === undefined ||
    prevUsd === undefined ||
    currentByn === undefined ||
    currentUsd === undefined
  ) {
    // Single-currency source (prometr quotes BYN only): there is no second figure to
    // cross-check against, and no conversion to drift, so any move is the seller's.
    const bynComparable = prevByn !== undefined && currentByn !== undefined;
    const usdComparable = prevUsd !== undefined && currentUsd !== undefined;
    if (bynComparable !== usdComparable) {
      return bynComparable ? prevByn !== currentByn : prevUsd !== currentUsd;
    }
    // A price appearing or disappearing has no percentage to compare — fall back to the
    // plain "both figures differ" test so "договорная" → priced is still reported.
    return prevByn !== currentByn && prevUsd !== currentUsd;
  }

  const bynPercent = ((currentByn - prevByn) / prevByn) * 100;
  const usdPercent = ((currentUsd - prevUsd) / prevUsd) * 100;

  const sameDirection = bynPercent > 0 === usdPercent > 0;

  return (
    sameDirection &&
    Math.abs(bynPercent) >= MIN_PRICE_CHANGE_PERCENT &&
    Math.abs(usdPercent) >= MIN_PRICE_CHANGE_PERCENT
  );
};
