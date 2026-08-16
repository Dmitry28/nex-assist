import type { CarListing, RemovedCarListing } from '../dto/car-listing.dto';
import { buildCaption, buildSummary, hasValue } from '../bid-cars-format';
import { isChallengePage } from '../bid-cars-parser.service';

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
    sourceUrl: 'https://bid.cars/en/search/results?make=Volkswagen',
  };

  it('includes date and counts', () => {
    const s = buildSummary(base);
    expect(s).toContain('24.03.2026');
    expect(s).toContain('30');
    expect(s).toContain('🆕 Новые: <b>6</b>');
    expect(s).toContain('🗑 Снятые: <b>2</b>');
  });

  it('includes the monitored source link', () => {
    const s = buildSummary(base);
    expect(s).toContain(
      '<a href="https://bid.cars/en/search/results?make=Volkswagen">🔗 Источник (bid.cars)</a>',
    );
  });

  it('omits sold line when soldUpdateCount is 0', () => {
    expect(buildSummary(base)).not.toContain('Цены продажи');
  });

  it('shows sold line when soldUpdateCount > 0', () => {
    expect(buildSummary({ ...base, soldUpdateCount: 3 })).toContain(
      'Цены продажи найдены: <b>3</b>',
    );
  });

  it('renders baseline summary when isBaseline=true', () => {
    const s = buildSummary({ ...base, isBaseline: true });
    expect(s).toContain('🏗 baseline');
    expect(s).toContain('<b>30</b>');
    expect(s).not.toContain('🆕 Новые');
    expect(s).not.toContain('🗑 Снятые');
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

// Our browser loads the sold-price pages, clears the challenge and still renders no lot — while
// a rendered provider fetch of the same URL returns all 50 archived Atlas lots. Telling those two
// apart is what decides whether "0 sold prices" is a fact or a silent failure.
describe('isChallengePage', () => {
  it('recognises the Cloudflare interstitial', () => {
    expect(isChallengePage('<html><head><title>Just a moment...</title></head></html>')).toBe(true);
    expect(isChallengePage('<div id="cf-browser-verification"></div>')).toBe(true);
  });

  it('does not mistake a real results page for one', () => {
    expect(isChallengePage('<html><title>Поиск Volkswagen Atlas - Архив | Bid.Cars</title>')).toBe(
      false,
    );
  });
});
