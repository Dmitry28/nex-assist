import { isListing } from './land-auctions.service';

describe('isListing', () => {
  it('returns true for valid listing', () =>
    expect(isListing({ link: 'https://gcn.by/lot/1' })).toBe(true));
  it('returns true with optional fields present', () =>
    expect(isListing({ link: 'https://gcn.by/lot/1', title: 'Plot', price: '1000' })).toBe(true));
  it('returns false for null', () => expect(isListing(null)).toBe(false));
  it('returns false for missing link', () => expect(isListing({ title: 'Plot' })).toBe(false));
  it('returns false when link is not a string', () => expect(isListing({ link: 42 })).toBe(false));
  it('returns false for primitive', () => expect(isListing('string')).toBe(false));
});
