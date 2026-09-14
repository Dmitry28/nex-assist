import { readFileSync } from 'fs';
import path from 'path';
import { isCataloguePage, parseIdriverCatalogueHtml } from '../idriver-parser.service';

const fixture = (name: string): string =>
  readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

describe('parseIdriverCatalogueHtml — Atlas Cross Sport catalogue', () => {
  const listings = parseIdriverCatalogueHtml(fixture('catalogue-atlas-cross-sport.html'));

  it('parses every offer card on the page', () => {
    expect(listings).toHaveLength(50);
  });

  it('derives a unique numeric id and an absolute url', () => {
    const ids = listings.map(l => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of listings) {
      expect(l.id).toMatch(/^\d+$/);
      expect(l.url).toMatch(
        new RegExp(`^https://idriver\\.by/auto-parts/[a-z0-9-]+/volkswagen/[a-z-]+/${l.id}$`),
      );
    }
  });

  it('reads the title, the part name and the donor year', () => {
    for (const l of listings) {
      expect(l.title).toContain('Volkswagen');
      expect(l.part.length).toBeGreaterThan(0);
      expect(l.part).not.toContain('Volkswagen');
    }
    const years = listings.map(l => l.year).filter((y): y is number => y !== undefined);
    expect(years.length).toBeGreaterThanOrEqual(45);
    for (const y of years) {
      expect(y).toBeGreaterThanOrEqual(2015);
      expect(y).toBeLessThanOrEqual(2030);
    }
  });

  it('extracts the BYN price from the microdata rather than the formatted span', () => {
    const priced = listings.filter(l => (l.priceByn ?? 0) > 0);
    expect(priced.length).toBeGreaterThanOrEqual(45);
    for (const l of priced) expect(Number.isInteger(l.priceByn)).toBe(true);
  });

  it('extracts city, seller and publication date from the card footer', () => {
    const withCity = listings.filter(l => l.city);
    expect(withCity.length).toBeGreaterThanOrEqual(45);
    for (const l of listings) {
      if (l.publishedAt) expect(l.publishedAt).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
      if (l.city) expect(l.city).not.toMatch(/\d{2}\.\d{2}\.\d{4}/);
    }
  });

  it('returns nothing for the verification stub, and rejects it as unusable', () => {
    const stub = fixture('verification-stub.html');
    expect(isCataloguePage(stub)).toBe(false);
    expect(parseIdriverCatalogueHtml(stub)).toEqual([]);
  });

  it('accepts the real catalogue as usable', () => {
    expect(isCataloguePage(fixture('catalogue-atlas-cross-sport.html'))).toBe(true);
  });
});
