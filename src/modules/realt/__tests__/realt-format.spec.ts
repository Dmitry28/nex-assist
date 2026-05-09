import type { RealtFeedResult, RealtListing } from '../dto/realt-listing.dto';
import {
  buildListingCaption,
  buildPriceChangeCaption,
  buildSummary,
  formatPrice,
  hasValue,
} from '../realt-format';

const baseListing: RealtListing = {
  adId: 123,
  uuid: 'uuid-x',
  link: 'https://realt.by/sale-plots/object/123/',
  title: 'Участок в Гродно',
  listTime: '2020-01-01T10:00:00.000Z',
  images: [],
};

describe('hasValue', () => {
  it('returns false for undefined', () => expect(hasValue(undefined)).toBe(false));
  it('returns false for empty string', () => expect(hasValue('')).toBe(false));
  it('returns false for "Не указано"', () => expect(hasValue('Не указано')).toBe(false));
  it('returns true for a real string', () => expect(hasValue('Гродно')).toBe(true));
  it('returns true for a number', () => expect(hasValue(42)).toBe(true));
  it('returns true for 0', () => expect(hasValue(0)).toBe(true));
});

describe('formatPrice', () => {
  it('returns empty string when both undefined', () => expect(formatPrice()).toBe(''));
  it('returns empty string when both 0', () => expect(formatPrice(0, 0)).toBe(''));
  it('formats BYN only', () => expect(formatPrice(21000)).toBe('21 000 BYN'));
  it('formats USD only', () => expect(formatPrice(undefined, 7200)).toBe('$7 200'));
  it('formats both', () => expect(formatPrice(21663, 7200)).toBe('21 663 BYN / $7 200'));
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
    expect(caption).toContain('https://realt.by/sale-plots/object/123/');
  });

  it('shows Договорная when no price', () => {
    const caption = buildListingCaption({ listing: baseListing, header: 'H', index: 1, total: 1 });
    expect(caption).toContain('💰 Договорная');
  });

  it('shows numeric price when present', () => {
    const listing = { ...baseListing, priceByn: 21663, priceUsd: 7200 };
    const caption = buildListingCaption({ listing, header: 'H', index: 1, total: 1 });
    expect(caption).toContain('💰 21 663 BYN / $7 200');
  });

  it('skips empty fields', () => {
    const listing = { ...baseListing, address: 'Не указано', seller: '' };
    const caption = buildListingCaption({ listing, header: 'H', index: 1, total: 1 });
    expect(caption).not.toContain('📍');
    expect(caption).not.toContain('👤');
  });

  it('includes optional fields when present', () => {
    const listing = { ...baseListing, address: 'Гродно', plotArea: 7, seller: 'Иван' };
    const caption = buildListingCaption({ listing, header: 'H', index: 1, total: 1 });
    expect(caption).toContain('📍 Гродно');
    expect(caption).toContain('🌱 7 сот.');
    expect(caption).toContain('👤 Иван');
  });

  it('renders house-specific fields (area, rooms, yearBuilt, storeys)', () => {
    const listing = {
      ...baseListing,
      area: 114.6,
      areaLiving: 48,
      areaKitchen: 24,
      rooms: 3,
      yearBuilt: 2025,
      storeys: 2,
      levels: 2,
    };
    const caption = buildListingCaption({ listing, header: 'H', index: 1, total: 1 });
    expect(caption).toContain('📐 114.6 м²');
    expect(caption).toContain('жил. 48 м²');
    expect(caption).toContain('кух. 24 м²');
    expect(caption).toContain('🚪 3 комн.');
    expect(caption).toContain('📅 2025 г.п.');
    expect(caption).toContain('🏢 2 эт.');
    expect(caption).not.toContain('🪜');
  });

  it('renders levels separately when different from storeys', () => {
    const listing = { ...baseListing, storeys: 1, levels: 2 };
    const caption = buildListingCaption({ listing, header: 'H', index: 1, total: 1 });
    expect(caption).toContain('🏢 1 эт.');
    expect(caption).toContain('🪜 2 уровн.');
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
    expect(caption).toContain('22 000 BYN / $7 300');
    expect(caption).toContain('21 431 BYN / $7 200');
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
  const feed: RealtFeedResult = {
    feedName: 'plots',
    total: 10,
    newListings: [baseListing, baseListing],
    priceChanges: [],
    truncated: false,
    isBaseline: false,
  };

  it('shows feed display name', () => {
    expect(buildSummary([feed])).toContain('Участки');
  });

  it('shows new listing count', () => {
    expect(buildSummary([feed])).toContain('🆕 2 новых');
  });

  it('shows без изменений when no activity', () => {
    const emptyFeed = { ...feed, newListings: [], priceChanges: [] };
    expect(buildSummary([emptyFeed])).toContain('без изменений');
  });

  it('renders baseline as "🏗 baseline · N сохранено"', () => {
    const baselineFeed: RealtFeedResult = {
      ...feed,
      newListings: [baseListing, baseListing, baseListing],
      isBaseline: true,
    };
    const summary = buildSummary([baselineFeed]);
    expect(summary).toContain('🏗 baseline');
    expect(summary).toContain('3 объявлений сохранено');
    expect(summary).not.toContain('🆕');
  });

  it('lists price changes inline', () => {
    const change = {
      listing: { ...baseListing, title: 'Участок', priceByn: 21000, priceUsd: 7000 },
      oldPriceByn: 22000,
      oldPriceUsd: 7300,
    };
    const feedWithChanges: RealtFeedResult = {
      ...feed,
      newListings: [],
      priceChanges: [change],
    };
    const summary = buildSummary([feedWithChanges]);
    expect(summary).toContain('💸 1 изм. цены');
    expect(summary).toContain('Участок');
    expect(summary).toContain('$7 300');
    expect(summary).toContain('$7 000');
  });
});
