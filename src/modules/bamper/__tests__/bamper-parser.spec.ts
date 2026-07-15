import { readFileSync } from 'fs';
import path from 'path';
import { parseBamperSearchHtml } from '../bamper-parser.service';

const FIXTURE = readFileSync(
  path.join(__dirname, 'fixtures/search-atlas-cross-sport.html'),
  'utf8',
);

describe('parseBamperSearchHtml', () => {
  const listings = parseBamperSearchHtml(FIXTURE);

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

  it('reads the title and the donor-car year', () => {
    for (const l of listings) {
      expect(l.title.toLowerCase()).toContain('бампер задний');
    }
    const years = listings.map(l => l.year).filter((y): y is number => y !== undefined);
    // The URL filter is god_2023-2026, so every stated year must fall in that window.
    expect(years.length).toBeGreaterThanOrEqual(6);
    for (const y of years) expect(y).toBeGreaterThanOrEqual(2023);
    for (const y of years) expect(y).toBeLessThanOrEqual(2026);
  });

  it('extracts the price (USD and/or BYN) for most listings', () => {
    const withUsd = listings.filter(l => (l.priceUsd ?? 0) > 0);
    expect(withUsd.length).toBeGreaterThanOrEqual(6);
  });

  it('extracts an absolute photo URL for every listing (fs.bamper.by or /upload/...)', () => {
    for (const l of listings) {
      expect(l.photoUrl).toMatch(/^https:\/\/(fs\.)?bamper\.by\/.+\.(jpg|jpeg|png|webp)$/);
    }
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
    expect(listings[0].photoUrl).toMatch(/^https:\/\/fs\.bamper\.by\/.+\.(jpg|jpeg|png|webp)$/);
    expect(listings[0].description).toContain('R-line');
  });

  it('extracts seller notes for every listing and a rating for rated sellers', () => {
    for (const l of listings) expect(l.description && l.description.length).toBeTruthy();
    const rated = listings.filter(l => l.sellerRating);
    expect(rated.length).toBeGreaterThanOrEqual(3);
    for (const l of rated) expect(l.sellerRating).toMatch(/^\d{1,3}%$/);
  });

  it('returns an empty array for HTML without a results list', () => {
    expect(parseBamperSearchHtml('<html><body>no results</body></html>')).toEqual([]);
  });
});
