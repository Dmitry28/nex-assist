import { isCarListing, isRemovedCarListing } from './bid-cars.service';

describe('isCarListing', () => {
  it('returns true for valid listing', () =>
    expect(isCarListing({ link: 'https://bid.cars/ru/lot/1/' })).toBe(true));
  it('returns true with optional fields present', () =>
    expect(
      isCarListing({ link: 'https://bid.cars/ru/lot/1/', vin: 'ABC', currentBid: '$1000' }),
    ).toBe(true));
  it('returns false for null', () => expect(isCarListing(null)).toBe(false));
  it('returns false for missing link', () => expect(isCarListing({ vin: 'ABC' })).toBe(false));
  it('returns false when link is not a string', () =>
    expect(isCarListing({ link: 123 })).toBe(false));
});

describe('isRemovedCarListing', () => {
  it('returns true when removedAt is a string', () =>
    expect(
      isRemovedCarListing({
        link: 'https://bid.cars/ru/lot/1/',
        removedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toBe(true));
  it('returns false when removedAt is missing', () =>
    expect(isRemovedCarListing({ link: 'https://bid.cars/ru/lot/1/' })).toBe(false));
  it('returns false when removedAt is not a string', () =>
    expect(isRemovedCarListing({ link: 'https://bid.cars/ru/lot/1/', removedAt: 123 })).toBe(
      false,
    ));
  it('returns false for invalid base listing', () =>
    expect(isRemovedCarListing({ removedAt: '2026-01-01T00:00:00.000Z' })).toBe(false));
});
