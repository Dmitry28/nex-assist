import type { KufarFeedConfig } from '../../../../config/kufar.config';
import type { KufarListing, KufarSnapshotEntry } from '../../dto/kufar-listing.dto';

export const feed1: KufarFeedConfig = { key: 'uchastok', url: 'https://re.kufar.by/l/uchastok' };
export const feed2: KufarFeedConfig = { key: 'dom', url: 'https://re.kufar.by/l/dom' };

export const listingA: KufarListing = {
  adId: 1,
  link: 'https://re.kufar.by/vi/1',
  title: 'Участок А',
  listTime: '2026-03-24T10:00:00.000Z',
  images: [],
  priceByn: 21000,
  priceUsd: 7000,
};

export const listingB: KufarListing = {
  adId: 2,
  link: 'https://re.kufar.by/vi/2',
  title: 'Участок Б',
  listTime: '2026-03-24T10:00:00.000Z',
  images: [],
  priceByn: 30000,
  priceUsd: 10000,
};

export const listingBPriceChanged: KufarListing = {
  ...listingB,
  priceByn: 28000,
  priceUsd: 9300,
};

export const snapshotA: KufarSnapshotEntry = {
  ...listingA,
  firstSeenAt: '2026-03-20T10:00:00.000Z',
  lastSeenAt: '2026-03-23T10:00:00.000Z',
};

export const snapshotB: KufarSnapshotEntry = {
  ...listingB,
  firstSeenAt: '2026-03-20T10:00:00.000Z',
  lastSeenAt: '2026-03-23T10:00:00.000Z',
};
