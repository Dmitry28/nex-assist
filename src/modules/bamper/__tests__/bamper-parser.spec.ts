import { readFileSync } from 'fs';
import path from 'path';
import { parseBamperSearchHtml } from '../bamper-parser.service';

const fixture = (name: string): string =>
  readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

describe('parseBamperSearchHtml — rear bumper', () => {
  const listings = parseBamperSearchHtml(fixture('search-atlas-cross-sport.html'), 'bamper-zadniy');

  it('parses every rear-bumper card on the page', () => {
    expect(listings).toHaveLength(7);
  });

  it('derives a unique stable id and absolute url from the listing slug', () => {
    const ids = listings.map(l => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of listings) {
      expect(l.id).toMatch(/^\d+-[A-Za-z0-9-]+$/);
      expect(l.url).toBe(`https://bamper.by/zapchast_bamper-zadniy/${l.id}/`);
    }
  });

  it('reads the title and the donor-car year within the filtered window', () => {
    for (const l of listings) expect(l.title.toLowerCase()).toContain('бампер задний');
    const years = listings.map(l => l.year).filter((y): y is number => y !== undefined);
    expect(years.length).toBeGreaterThanOrEqual(6);
    for (const y of years) {
      expect(y).toBeGreaterThanOrEqual(2023);
      expect(y).toBeLessThanOrEqual(2026);
    }
  });

  it('extracts price and an absolute photo URL for the listings', () => {
    expect(listings.filter(l => (l.priceUsd ?? 0) > 0).length).toBeGreaterThanOrEqual(6);
    for (const l of listings) {
      expect(l.photoUrl).toMatch(/^https:\/\/(fs\.)?bamper\.by\/.+\.(jpg|jpeg|png|webp)$/);
    }
  });

  it('extracts seller notes for every listing and a rating for rated sellers', () => {
    for (const l of listings) expect(l.description && l.description.length).toBeTruthy();
    const rated = listings.filter(l => l.sellerRating);
    expect(rated.length).toBeGreaterThanOrEqual(3);
    for (const l of rated) expect(l.sellerRating).toMatch(/^\d{1,3}%$/);
  });

  it('matches the first card exactly', () => {
    expect(listings[0]).toMatchObject({
      id: '105924-108638066',
      url: 'https://bamper.by/zapchast_bamper-zadniy/105924-108638066/',
      year: 2024,
      priceByn: 4350,
      priceUsd: 1519,
      city: 'Минск',
      sellerRating: '86%',
    });
    expect(listings[0].description).toContain('R-line');
  });
});

describe('parseBamperSearchHtml — tailgate', () => {
  const listings = parseBamperSearchHtml(
    fixture('search-tailgate.html'),
    'kryshka-bagazhnika-dver-3-5',
  );

  it('parses tailgate cards and builds tailgate URLs', () => {
    expect(listings.length).toBeGreaterThanOrEqual(4);
    for (const l of listings) {
      expect(l.title.toLowerCase()).toContain('крышка багажника');
      expect(l.url).toBe(`https://bamper.by/zapchast_kryshka-bagazhnika-dver-3-5/${l.id}/`);
    }
  });

  it('keeps years within the filtered restyle window', () => {
    const years = listings.map(l => l.year).filter((y): y is number => y !== undefined);
    for (const y of years) {
      expect(y).toBeGreaterThanOrEqual(2023);
      expect(y).toBeLessThanOrEqual(2026);
    }
  });
});

describe('parseBamperSearchHtml — edge cases', () => {
  it('returns an empty array for HTML without a results list', () => {
    expect(parseBamperSearchHtml('<html><body>no results</body></html>', 'bamper-zadniy')).toEqual(
      [],
    );
  });

  it('ignores listings of a different part slug on the page', () => {
    const bumperPage = fixture('search-atlas-cross-sport.html');
    expect(parseBamperSearchHtml(bumperPage, 'kryshka-bagazhnika-dver-3-5')).toEqual([]);
  });
});
