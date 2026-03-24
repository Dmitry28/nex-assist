import { mapListing, toNum, toStr, getParam, type RawAd } from './kufar-parser.service';

const baseAd: RawAd = {
  ad_id: 42,
  subject: 'Участок в Гродно',
  list_time: '2026-03-24T10:00:00.000Z',
};

describe('toNum', () => {
  it('coerces a number', () => expect(toNum(5)).toBe(5));
  it('coerces a numeric string', () => expect(toNum('3.5')).toBe(3.5));
  it('returns undefined for non-numeric string', () => expect(toNum('abc')).toBeUndefined());
  it('returns undefined for undefined', () => expect(toNum(undefined)).toBeUndefined());
  it('returns undefined for Infinity', () => expect(toNum(Infinity)).toBeUndefined());
});

describe('toStr', () => {
  it('trims and returns a string', () => expect(toStr('  Гродно  ')).toBe('Гродно'));
  it('returns undefined for empty string', () => expect(toStr('')).toBeUndefined());
  it('returns undefined for whitespace', () => expect(toStr('   ')).toBeUndefined());
  it('returns undefined for non-string', () => expect(toStr(42)).toBeUndefined());
});

describe('getParam', () => {
  const params = [
    { p: 'size', v: '50', vl: '50 м²' },
    { p: 'land_type', v: 'dacha', vl: 'Дача' },
  ];

  it('gets v field by default', () => expect(getParam(params, 'size')).toBe('50'));
  it('gets vl field when requested', () =>
    expect(getParam(params, 'land_type', 'vl')).toBe('Дача'));
  it('returns undefined for missing key', () => expect(getParam(params, 'rooms')).toBeUndefined());
  it('returns undefined for empty params', () =>
    expect(getParam(undefined, 'size')).toBeUndefined());
});

describe('mapListing', () => {
  it('maps basic fields', () => {
    const listing = mapListing(baseAd);
    expect(listing.adId).toBe(42);
    expect(listing.title).toBe('Участок в Гродно');
    expect(listing.link).toBe('https://re.kufar.by/vi/42');
    expect(listing.listTime).toBe('2026-03-24T10:00:00.000Z');
    expect(listing.images).toEqual([]);
  });

  it('parses BYN and USD prices (divides by 100)', () => {
    const listing = mapListing({ ...baseAd, price_byn: '2166300', price_usd: '720000' });
    expect(listing.priceByn).toBe(21663);
    expect(listing.priceUsd).toBe(7200);
  });

  it('returns undefined prices when 0 or absent', () => {
    const listing = mapListing({ ...baseAd, price_byn: '0', price_usd: '0' });
    expect(listing.priceByn).toBeUndefined();
    expect(listing.priceUsd).toBeUndefined();
  });

  it('returns undefined prices when fields missing (договорная)', () => {
    const listing = mapListing(baseAd);
    expect(listing.priceByn).toBeUndefined();
    expect(listing.priceUsd).toBeUndefined();
  });

  it('maps address and seller from account_parameters', () => {
    const listing = mapListing({
      ...baseAd,
      account_parameters: [
        { p: 'address', v: 'Гродно, ул. Советская' },
        { p: 'name', v: 'Иван Иванов' },
      ],
    });
    expect(listing.address).toBe('Гродно, ул. Советская');
    expect(listing.seller).toBe('Иван Иванов');
  });

  it('maps area and plotArea from ad_parameters', () => {
    const listing = mapListing({
      ...baseAd,
      ad_parameters: [
        { p: 'size', v: '80' },
        { p: 'size_area', v: '7' },
        { p: 'rooms', v: '3' },
        { p: 'year_built', v: '2005' },
      ],
    });
    expect(listing.area).toBe(80);
    expect(listing.plotArea).toBe(7);
    expect(listing.rooms).toBe(3);
    expect(listing.yearBuilt).toBe(2005);
  });

  it('picks propertyType from land_type vl', () => {
    const listing = mapListing({
      ...baseAd,
      ad_parameters: [{ p: 'land_type', v: 'dacha', vl: 'Дача' }],
    });
    expect(listing.propertyType).toBe('Дача');
  });

  it('collects scalar features', () => {
    const listing = mapListing({
      ...baseAd,
      ad_parameters: [
        { p: 're_heating', v: 'gas', vl: 'Газ' },
        { p: 're_water', v: 'central', vl: 'Централизованное' },
      ],
    });
    expect(listing.features).toEqual(['Газ', 'Централизованное']);
  });

  it('collects array features', () => {
    const listing = mapListing({
      ...baseAd,
      ad_parameters: [{ p: 're_outbuildings', v: [], vl: ['Баня', 'Гараж'] }],
    });
    expect(listing.features).toEqual(['Баня', 'Гараж']);
  });

  it('returns undefined features when none present', () => {
    expect(mapListing(baseAd).features).toBeUndefined();
  });

  it('builds image URLs from CDN base', () => {
    const listing = mapListing({
      ...baseAd,
      images: [{ path: 'abc/123.jpg' }, { path: 'def/456.jpg' }],
    });
    expect(listing.images[0]).toMatch(/rms\.kufar\.by\/v1\/list_thumbs_2x\/abc\/123\.jpg/);
    expect(listing.images).toHaveLength(2);
  });

  it('uses undefined description when body_short is absent', () => {
    expect(mapListing(baseAd).description).toBeUndefined();
  });

  it('uses description when body_short present', () => {
    expect(mapListing({ ...baseAd, body_short: 'Хороший участок' }).description).toBe(
      'Хороший участок',
    );
  });
});
