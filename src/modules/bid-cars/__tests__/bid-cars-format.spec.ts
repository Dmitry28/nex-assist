import type { CarListing, RemovedCarListing } from '../dto/car-listing.dto';
import { buildCaption, buildSummary, hasValue } from '../bid-cars-format';

const baseListing: CarListing = {
  link: 'https://bid.cars/ru/lot/12345/vw-atlas-2024',
  title: '2024 Volkswagen Atlas',
};

describe('hasValue', () => {
  it('returns true for a real string', () => expect(hasValue('Copart')).toBe(true));
  it('returns false for undefined', () => expect(hasValue(undefined)).toBe(false));
  it('returns false for empty string', () => expect(hasValue('')).toBe(false));
});

describe('buildSummary', () => {
  const base = {
    date: new Date('2026-03-24'),
    total: 30,
    newCount: 6,
    removedCount: 2,
    soldUpdateCount: 0,
  };

  it('includes date and counts', () => {
    const s = buildSummary(base);
    expect(s).toContain('24.03.2026');
    expect(s).toContain('30');
    expect(s).toContain('🆕 Новые: <b>6</b>');
    expect(s).toContain('🗑 Снятые: <b>2</b>');
  });

  it('omits sold line when soldUpdateCount is 0', () => {
    expect(buildSummary(base)).not.toContain('Цены продажи');
  });

  it('shows sold line when soldUpdateCount > 0', () => {
    expect(buildSummary({ ...base, soldUpdateCount: 3 })).toContain(
      'Цены продажи найдены: <b>3</b>',
    );
  });
});

describe('buildCaption', () => {
  it('includes header, title and link', () => {
    const c = buildCaption({ listing: baseListing, header: '🆕 Новые', index: 1, total: 5 });
    expect(c).toContain('🆕 Новые · 1/5');
    expect(c).toContain('2024 Volkswagen Atlas');
    expect(c).toContain('https://bid.cars/ru/lot/12345');
  });

  it('shows currentBid and buyNow when present', () => {
    const listing: CarListing = { ...baseListing, currentBid: '$1 500', buyNow: '$4 200' };
    const c = buildCaption({ listing, header: 'H', index: 1, total: 1 });
    expect(c).toContain('💰 Ставка: $1 500');
    expect(c).toContain('🛒 <b>Купить сейчас: $4 200</b>');
  });

  it('shows soldPrice instead of bid when listing is removed with price', () => {
    const listing: RemovedCarListing = { ...baseListing, removedAt: '', soldPrice: '$3 800' };
    const c = buildCaption({ listing, header: 'H', index: 1, total: 1 });
    expect(c).toContain('💰 Продано за: <b>$3 800</b>');
    expect(c).not.toContain('Ставка');
  });

  it('shows VIN and lot', () => {
    const listing: CarListing = { ...baseListing, vin: '1V2WR2CA4RC123456', lot: '12345' };
    const c = buildCaption({ listing, header: 'H', index: 1, total: 1 });
    expect(c).toContain('<code>1V2WR2CA4RC123456</code>');
    expect(c).toContain('Лот: 12345');
  });

  it('falls back to Без названия when title missing', () => {
    const listing: CarListing = { link: 'https://bid.cars/ru/lot/1/' };
    const c = buildCaption({ listing, header: 'H', index: 1, total: 1 });
    expect(c).toContain('Без названия');
  });

  it('skips empty optional fields', () => {
    const c = buildCaption({ listing: baseListing, header: 'H', index: 1, total: 1 });
    expect(c).not.toContain('💥');
    expect(c).not.toContain('📏');
    expect(c).not.toContain('🏛');
  });
});
