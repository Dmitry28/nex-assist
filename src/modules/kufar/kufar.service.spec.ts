import { effectivePrice, hasPriceChanged } from './kufar.service';
import type { KufarListing, KufarSnapshotEntry } from './dto/kufar-listing.dto';

const makeEntry = (priceByn?: number, priceUsd?: number): KufarSnapshotEntry => ({
  adId: 1,
  link: 'https://re.kufar.by/vi/1',
  title: 'Test',
  listTime: '2026-01-01T00:00:00.000Z',
  images: [],
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
  priceByn,
  priceUsd,
});

const makeListing = (priceByn?: number, priceUsd?: number): KufarListing => ({
  adId: 1,
  link: 'https://re.kufar.by/vi/1',
  title: 'Test',
  listTime: '2026-01-01T00:00:00.000Z',
  images: [],
  priceByn,
  priceUsd,
});

describe('effectivePrice', () => {
  it('returns the value when positive', () => expect(effectivePrice(7200)).toBe(7200));
  it('returns undefined for 0', () => expect(effectivePrice(0)).toBeUndefined());
  it('returns undefined for undefined', () => expect(effectivePrice(undefined)).toBeUndefined());
});

describe('hasPriceChanged', () => {
  it('returns true when both BYN and USD changed', () => {
    expect(hasPriceChanged(makeEntry(21000, 7000), makeListing(22000, 7300))).toBe(true);
  });

  it('returns false when BYN same (seller set price in BYN, USD fluctuated)', () => {
    expect(hasPriceChanged(makeEntry(21663, 7200), makeListing(21663, 7179))).toBe(false);
  });

  it('returns false when USD same (seller set price in USD, BYN fluctuated)', () => {
    expect(hasPriceChanged(makeEntry(21663, 7200), makeListing(21431, 7200))).toBe(false);
  });

  it('returns false when nothing changed', () => {
    expect(hasPriceChanged(makeEntry(21663, 7200), makeListing(21663, 7200))).toBe(false);
  });

  it('returns true when price removed (both go to undefined)', () => {
    // undefined !== 7200 for BYN, undefined !== 7000 for USD → true
    expect(hasPriceChanged(makeEntry(21663, 7200), makeListing(undefined, undefined))).toBe(true);
  });

  it('returns true when price added from договорная', () => {
    expect(hasPriceChanged(makeEntry(undefined, undefined), makeListing(21000, 7000))).toBe(true);
  });

  it('treats 0 same as undefined (no false positives)', () => {
    expect(hasPriceChanged(makeEntry(0, 0), makeListing(0, 0))).toBe(false);
  });
});
