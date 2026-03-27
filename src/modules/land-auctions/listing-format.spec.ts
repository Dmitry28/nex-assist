import type { Listing } from './dto/listing.dto';
import {
  buildCaption,
  buildSummary,
  formatAuctionDate,
  formatDeadline,
  getListingEmoji,
  shortenCommunications,
} from './listing-format';

const baseListing: Listing = {
  link: 'https://gcn.by/lot/123',
  title: 'Жилой дом в д. Заболоть',
};

const summaryBase = {
  date: new Date('2026-03-24'),
  total: 24,
  newCount: 3,
  removedCount: 1,
  specialCount: 5,
  newSpecialCount: 2,
};

describe('getListingEmoji', () => {
  it('returns 🏠 for жилой дом', () =>
    expect(getListingEmoji('Жилой дом по ул. Советской')).toBe('🏠'));
  it('returns 🏗 for незавершённое строительство', () =>
    expect(getListingEmoji('Незавершённое строительство')).toBe('🏗'));
  it('returns 🏗 for не завершён', () => expect(getListingEmoji('Объект не завершён')).toBe('🏗'));
  it('returns 🏡 by default', () => expect(getListingEmoji('Земельный участок')).toBe('🏡'));
  it('returns 🏡 for undefined', () => expect(getListingEmoji(undefined)).toBe('🏡'));
});

describe('formatAuctionDate', () => {
  it('strips Аукцион состоится prefix', () =>
    expect(formatAuctionDate('Аукцион состоится 10 апреля 2026')).toBe('10 апреля 2026'));
  it('strips Проведение аукциона планируется prefix', () =>
    expect(formatAuctionDate('Проведение аукциона планируется 15 мая')).toBe('15 мая'));
  it('returns уточняется for overly long string', () =>
    expect(formatAuctionDate('A'.repeat(200))).toBe('уточняется'));
  it('returns value as-is when short and no prefix', () =>
    expect(formatAuctionDate('10.04.2026')).toBe('10.04.2026'));
});

describe('formatDeadline', () => {
  it('strips prefix', () =>
    expect(formatDeadline('Заявления принимаются по 05.04.2026')).toBe('05.04.2026'));
});

describe('shortenCommunications', () => {
  it('replaces all utility names', () => {
    const result = shortenCommunications(
      'электроснабжение, газоснабжение, водоснабжение, водоотведение, теплоснабжение',
    );
    expect(result).toBe('свет, газ, вода, канализация, тепло');
  });
  it('is case-insensitive', () => expect(shortenCommunications('Электроснабжение')).toBe('свет'));
});

describe('buildSummary', () => {
  it('includes all fields', () => {
    const s = buildSummary(summaryBase);
    expect(s).toContain('24.03.2026');
    expect(s).toContain('Всего объявлений: <b>24</b>');
    expect(s).toContain('🆕 Новые: <b>3</b>');
    expect(s).toContain('🗑 Удалённые: <b>1</b>');
    expect(s).toContain('Всего в Заболоть: <b>5</b>');
    expect(s).toContain('Новые в Заболоть: <b>2</b>');
  });
});

describe('buildCaption', () => {
  it('includes header, emoji, title, link', () => {
    const c = buildCaption({ listing: baseListing, header: '🆕 Новые', index: 2, total: 5 });
    expect(c).toContain('🆕 Новые · 2/5');
    expect(c).toContain('🏠');
    expect(c).toContain('Жилой дом в д. Заболоть');
    expect(c).toContain('https://gcn.by/lot/123');
  });

  it('shows price and area on one line', () => {
    const listing: Listing = { ...baseListing, price: '50 000 руб.', area: '0.15 га' };
    const c = buildCaption({ listing, header: 'H', index: 1, total: 1 });
    expect(c).toContain('💰 50 000 руб.');
    expect(c).toContain('📐 0.15 га');
  });

  it('shows auction date with prefix stripped', () => {
    const listing: Listing = { ...baseListing, auctionDate: 'Аукцион состоится 10 апреля 2026' };
    const c = buildCaption({ listing, header: 'H', index: 1, total: 1 });
    expect(c).toContain('🗓 10 апреля 2026');
    expect(c).not.toContain('Аукцион состоится');
  });

  it('shows shortened communications', () => {
    const listing: Listing = { ...baseListing, communications: 'электроснабжение, газоснабжение' };
    const c = buildCaption({ listing, header: 'H', index: 1, total: 1 });
    expect(c).toContain('⚡ свет, газ');
  });

  it('includes cadastral map link when present', () => {
    const listing: Listing = { ...baseListing, cadastralMapUrl: 'https://map.nca.by/123' };
    const c = buildCaption({ listing, header: 'H', index: 1, total: 1 });
    expect(c).toContain('📌 Карта');
    expect(c).toContain('https://map.nca.by/123');
  });

  it('skips empty/missing optional fields', () => {
    const c = buildCaption({ listing: baseListing, header: 'H', index: 1, total: 1 });
    expect(c).not.toContain('💰');
    expect(c).not.toContain('🗓');
    expect(c).not.toContain('⚡');
  });

  it('shows sale price when present', () => {
    const listing: Listing = { ...baseListing, price: '19 370 руб.', salePrice: '42 тыс. руб.' };
    const c = buildCaption({ listing, header: 'H', index: 1, total: 1 });
    expect(c).toContain('✅ Продано: 42 тыс. руб.');
  });

  it('does not show sale price when absent', () => {
    const listing: Listing = { ...baseListing, price: '19 370 руб.' };
    const c = buildCaption({ listing, header: 'H', index: 1, total: 1 });
    expect(c).not.toContain('Продано');
  });
});
