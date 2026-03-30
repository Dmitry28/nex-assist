import type { KufarFeedResult, KufarListing } from '../dto/kufar-listing.dto';
import {
  buildListingCaption,
  buildPriceChangeCaption,
  buildSummary,
  formatPrice,
  hasValue,
} from '../kufar-format';

const baseListing: KufarListing = {
  adId: 123,
  link: 'https://re.kufar.by/vi/123',
  title: 'Участок в Гродно',
  listTime: '2020-01-01T10:00:00.000Z',
  images: [],
};

describe('hasValue', () => {
  it('returns false for undefined', () => expect(hasValue(undefined)).toBe(false));
  it('returns false for empty string', () => expect(hasValue('')).toBe(false));
  it('returns false for "Не указано"', () => expect(hasValue('Не указано')).toBe(false));
  it('returns false for "Не указан"', () => expect(hasValue('Не указан')).toBe(false));
  it('returns false for "Не указана"', () => expect(hasValue('Не указана')).toBe(false));
  it('returns true for a real string', () => expect(hasValue('Гродно')).toBe(true));
  it('returns true for a number', () => expect(hasValue(42)).toBe(true));
  it('returns true for 0', () => expect(hasValue(0)).toBe(true));
});

describe('formatPrice', () => {
  it('returns empty string when both undefined', () => expect(formatPrice()).toBe(''));
  it('returns empty string when both 0', () => expect(formatPrice(0, 0)).toBe(''));
  it('formats BYN only', () => expect(formatPrice(21000)).toBe('21\u00a0000 BYN'));
  it('formats USD only', () => expect(formatPrice(undefined, 7200)).toBe('$7\u00a0200'));
  it('formats both', () => expect(formatPrice(21663, 7200)).toBe('21\u00a0663 BYN / $7\u00a0200'));
});

describe('buildListingCaption', () => {
  it('includes header, title, link', () => {
    const caption = buildListingCaption({
      listing: baseListing,
      header: '🆕 Новые',
      index: 1,
      total: 3,
    });
    expect(caption).toContain('🆕 Новые · 1/3');
    expect(caption).toContain('Участок в Гродно');
    expect(caption).toContain('https://re.kufar.by/vi/123');
  });

  it('shows Договорная when no price', () => {
    const caption = buildListingCaption({ listing: baseListing, header: 'H', index: 1, total: 1 });
    expect(caption).toContain('💰 Договорная');
  });

  it('shows numeric price when present', () => {
    const listing = { ...baseListing, priceByn: 21663, priceUsd: 7200 };
    const caption = buildListingCaption({ listing, header: 'H', index: 1, total: 1 });
    expect(caption).toContain('💰 21\u00a0663 BYN / $7\u00a0200');
  });

  it('skips empty/Не указано fields', () => {
    const listing = { ...baseListing, address: 'Не указано', seller: '' };
    const caption = buildListingCaption({ listing, header: 'H', index: 1, total: 1 });
    expect(caption).not.toContain('📍');
    expect(caption).not.toContain('👤');
  });

  it('includes optional fields when present', () => {
    const listing = {
      ...baseListing,
      address: 'Гродно',
      plotArea: 7,
      area: 50,
      rooms: 3,
      yearBuilt: 2010,
      features: ['Газ', 'Вода'],
      seller: 'Иван',
    };
    const caption = buildListingCaption({ listing, header: 'H', index: 1, total: 1 });
    expect(caption).toContain('📍 Гродно');
    expect(caption).toContain('🌱 7 сот.');
    expect(caption).toContain('📐 50 м²');
    expect(caption).toContain('🚪 3 комн.');
    expect(caption).toContain('📅 2010 г.п.');
    expect(caption).toContain('✅ Газ, Вода');
    expect(caption).toContain('👤 Иван');
  });
});

describe('buildPriceChangeCaption', () => {
  it('shows old → new price', () => {
    const caption = buildPriceChangeCaption({
      change: {
        listing: { ...baseListing, priceByn: 21431, priceUsd: 7200 },
        oldPriceByn: 22000,
        oldPriceUsd: 7300,
      },
      header: '💸 Изменение цены',
      index: 1,
      total: 1,
    });
    expect(caption).toContain('22\u00a0000 BYN / $7\u00a0300');
    expect(caption).toContain('21\u00a0431 BYN / $7\u00a0200');
    expect(caption).toContain('→');
  });

  it('shows Договорная for negotiable old price', () => {
    const caption = buildPriceChangeCaption({
      change: {
        listing: { ...baseListing, priceByn: 21000, priceUsd: 7000 },
        oldPriceByn: undefined,
        oldPriceUsd: undefined,
      },
      header: 'H',
      index: 1,
      total: 1,
    });
    expect(caption).toContain('💰 Договорная →');
  });

  it('shows Договорная for negotiable new price', () => {
    const caption = buildPriceChangeCaption({
      change: { listing: baseListing, oldPriceByn: 21000, oldPriceUsd: 7000 },
      header: 'H',
      index: 1,
      total: 1,
    });
    expect(caption).toContain('→ <b>Договорная</b>');
  });
});

describe('buildSummary', () => {
  const feed: KufarFeedResult = {
    feedName: 'uchastok',
    total: 10,
    newListings: [baseListing, baseListing],
    priceChanges: [],
    truncated: false,
  };

  it('shows feed display name', () => {
    const summary = buildSummary([feed]);
    expect(summary).toContain('Участки');
  });

  it('shows new listing count', () => {
    const summary = buildSummary([feed]);
    expect(summary).toContain('🆕 2 новых');
  });

  it('shows без изменений when no activity', () => {
    const emptyFeed = { ...feed, newListings: [], priceChanges: [] };
    expect(buildSummary([emptyFeed])).toContain('без изменений');
  });

  it('lists price changes inline', () => {
    const change = {
      listing: { ...baseListing, title: 'Участок', priceByn: 21000, priceUsd: 7000 },
      oldPriceByn: 22000,
      oldPriceUsd: 7300,
    };
    const feedWithChanges = { ...feed, newListings: [], priceChanges: [change] };
    const summary = buildSummary([feedWithChanges]);
    expect(summary).toContain('💸 1 изм. цены');
    expect(summary).toContain('Участок');
    expect(summary).toContain('$7\u00a0300');
    expect(summary).toContain('$7\u00a0000');
  });
});
