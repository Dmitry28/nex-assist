import { mapListing, type RawObject } from '../realt-parser.service';

const baseObj: RawObject = {
  code: 4118883,
  uuid: 'uuid-1',
  updatedAt: '2026-05-08T18:56:46+03:00',
};

describe('mapListing', () => {
  it('maps basic fields', () => {
    const listing = mapListing({ ...baseObj, townName: 'Гродно', streetName: 'ул. Советская' });
    expect(listing.adId).toBe(4118883);
    expect(listing.uuid).toBe('uuid-1');
    expect(listing.link).toBe('https://realt.by/sale-plots/object/4118883/');
    expect(listing.title).toBe('Гродно, ул. Советская');
    expect(listing.listTime).toBe('2026-05-08T18:56:46+03:00');
    expect(listing.images).toEqual([]);
  });

  it('parses BYN and USD prices from priceRates', () => {
    const listing = mapListing({
      ...baseObj,
      priceRates: { '840': 24000, '933': 67646, '643': 1788594 },
    });
    expect(listing.priceUsd).toBe(24000);
    expect(listing.priceByn).toBe(67646);
  });

  it('rounds non-integer prices', () => {
    const listing = mapListing({ ...baseObj, priceRates: { '840': 24000.6, '933': 67646.4 } });
    expect(listing.priceUsd).toBe(24001);
    expect(listing.priceByn).toBe(67646);
  });

  it('returns undefined prices when 0 or absent', () => {
    expect(mapListing({ ...baseObj, priceRates: { '840': 0, '933': 0 } }).priceByn).toBeUndefined();
    expect(mapListing(baseObj).priceUsd).toBeUndefined();
  });

  it('uses areaLand directly as plotArea (sotki)', () => {
    expect(mapListing({ ...baseObj, areaLand: 9.84 }).plotArea).toBe(9.84);
  });

  it('returns undefined plotArea when areaLand is 0/null', () => {
    expect(mapListing({ ...baseObj, areaLand: 0 }).plotArea).toBeUndefined();
    expect(mapListing({ ...baseObj, areaLand: null }).plotArea).toBeUndefined();
  });

  it('falls back to "Участок" when no title or town/street', () => {
    expect(mapListing(baseObj).title).toBe('Участок');
  });

  it('uses headline as description', () => {
    expect(mapListing({ ...baseObj, headline: 'Хороший участок' }).description).toBe(
      'Хороший участок',
    );
  });

  it('passes through full address and contact', () => {
    const listing = mapListing({
      ...baseObj,
      address: 'Гродно, ул. Советская, 1',
      contactName: 'Иван',
    });
    expect(listing.address).toBe('Гродно, ул. Советская, 1');
    expect(listing.seller).toBe('Иван');
  });

  it('passes images array through unchanged', () => {
    const images = ['https://cdn.realt.by/img/55/a', 'https://cdn.realt.by/img/55/b'];
    expect(mapListing({ ...baseObj, images }).images).toEqual(images);
  });

  it('trims whitespace in town/street when building title', () => {
    expect(
      mapListing({ ...baseObj, townName: '  Гродно  ', streetName: '  ул. Советская  ' }).title,
    ).toBe('Гродно, ул. Советская');
  });
});
