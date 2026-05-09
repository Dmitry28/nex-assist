import type { RealtFeedConfig } from '../../../../config/realt.config';
import type { RealtListing, RealtSnapshotEntry } from '../../dto/realt-listing.dto';

export const feed1: RealtFeedConfig = {
  key: 'plots',
  url: 'https://realt.by/grodno/plots',
  linkPath: 'sale-plots',
};
export const feed2: RealtFeedConfig = {
  key: 'dom',
  url: 'https://realt.by/grodno/houses',
  linkPath: 'sale-cottages',
};

export const listingA: RealtListing = {
  adId: 1001,
  uuid: 'uuid-a',
  link: 'https://realt.by/sale-plots/object/1001/',
  title: 'Гродно, ул. Советская',
  listTime: '2026-05-08T18:56:46+03:00',
  images: [],
  priceByn: 21000,
  priceUsd: 7000,
};

export const listingB: RealtListing = {
  adId: 1002,
  uuid: 'uuid-b',
  link: 'https://realt.by/sale-plots/object/1002/',
  title: 'Гродно, пер. Виктора Юртова',
  listTime: '2026-05-08T18:56:46+03:00',
  images: [],
  priceByn: 30000,
  priceUsd: 10000,
};

export const listingBPriceChanged: RealtListing = {
  ...listingB,
  priceByn: 28000,
  priceUsd: 9300,
};

export const snapshotA: RealtSnapshotEntry = {
  ...listingA,
  firstSeenAt: '2026-05-01T10:00:00.000Z',
  lastSeenAt: '2026-05-07T10:00:00.000Z',
};

export const snapshotB: RealtSnapshotEntry = {
  ...listingB,
  firstSeenAt: '2026-05-01T10:00:00.000Z',
  lastSeenAt: '2026-05-07T10:00:00.000Z',
};
