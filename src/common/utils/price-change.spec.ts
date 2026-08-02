import { effectivePrice, hasPriceChanged, MIN_PRICE_CHANGE_PERCENT } from './price-change';

describe('effectivePrice', () => {
  it.each([
    [undefined, undefined],
    [0, undefined],
    [-1, undefined],
    [100, 100],
  ])('maps %p to %p', (input, expected) => {
    expect(effectivePrice(input)).toBe(expected);
  });
});

describe('hasPriceChanged', () => {
  it('ignores a listing whose price did not move at all', () => {
    expect(
      hasPriceChanged(
        { priceByn: 300_000, priceUsd: 100_000 },
        { priceByn: 300_000, priceUsd: 100_000 },
      ),
    ).toBe(false);
  });

  describe('exchange-rate drift (must NOT be reported)', () => {
    it('ignores drift when the seller priced in USD (USD figure stays put)', () => {
      expect(
        hasPriceChanged(
          { priceByn: 300_000, priceUsd: 100_000 },
          { priceByn: 318_000, priceUsd: 100_000 },
        ),
      ).toBe(false);
    });

    it('ignores drift when the seller priced in BYN (BYN figure stays put)', () => {
      expect(
        hasPriceChanged(
          { priceByn: 300_000, priceUsd: 100_000 },
          { priceByn: 300_000, priceUsd: 94_720 },
        ),
      ).toBe(false);
    });

    // Real signature observed on realt.by: two unrelated listings both moved -2.58% USD / +0.69% BYN.
    it('ignores third-currency drift that pushes the two figures in opposite directions', () => {
      expect(
        hasPriceChanged(
          { priceByn: 300_000, priceUsd: 94_152 },
          { priceByn: 302_070, priceUsd: 91_723 },
        ),
      ).toBe(false);
    });

    it('ignores a same-direction move too small to be a seller edit', () => {
      // -1.4% / -1.5%: below the threshold, matches observed drift on untouched listings.
      expect(
        hasPriceChanged(
          { priceByn: 300_000, priceUsd: 100_000 },
          { priceByn: 295_500, priceUsd: 98_600 },
        ),
      ).toBe(false);
    });
  });

  describe('seller edits (must be reported)', () => {
    it('reports a cut that moves both figures together', () => {
      // Observed: усадьба на хуторе, -19.74% USD / -19.54% BYN.
      expect(
        hasPriceChanged(
          { priceByn: 449_040, priceUsd: 149_680 },
          { priceByn: 361_300, priceUsd: 120_139 },
        ),
      ).toBe(true);
    });

    it('reports an increase that moves both figures together', () => {
      expect(
        hasPriceChanged(
          { priceByn: 196_200, priceUsd: 65_400 },
          { priceByn: 229_870, priceUsd: 75_500 },
        ),
      ).toBe(true);
    });

    it('reports a cut of exactly the minimum percentage', () => {
      const factor = 1 - MIN_PRICE_CHANGE_PERCENT / 100;
      expect(
        hasPriceChanged(
          { priceByn: 300_000, priceUsd: 100_000 },
          { priceByn: 300_000 * factor, priceUsd: 100_000 * factor },
        ),
      ).toBe(true);
    });
  });

  describe('missing prices', () => {
    it('reports a listing that gained a price', () => {
      expect(hasPriceChanged({}, { priceByn: 300_000, priceUsd: 100_000 })).toBe(true);
    });

    it('reports a listing that lost its price', () => {
      expect(hasPriceChanged({ priceByn: 300_000, priceUsd: 100_000 }, {})).toBe(true);
    });

    it('ignores a listing that never had a price', () => {
      expect(hasPriceChanged({}, {})).toBe(false);
    });

    it('ignores a zero price replacing undefined — both mean "no price"', () => {
      expect(hasPriceChanged({ priceByn: 0, priceUsd: 0 }, {})).toBe(false);
    });
  });
});
