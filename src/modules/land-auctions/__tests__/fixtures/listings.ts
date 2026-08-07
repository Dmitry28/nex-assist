import { ARCHIVE_PENDING_TTL_DAYS } from '../../constants';
import type { ArchivePendingItem, Listing } from '../../dto/listing.dto';
import type { GrodnorikNotice } from '../../dto/grodnorik-notice.dto';

// ---------------------------------------------------------------------------
// Base listings
// ---------------------------------------------------------------------------

export const listingA: Listing = {
  link: 'https://gcn.by/1',
  title: 'Участок А',
  price: '10 000 руб.',
  auctionDate: 'Аукцион состоится 24.03.2026',
};

export const listingB: Listing = {
  link: 'https://gcn.by/2',
  title: 'Участок Б',
  price: '20 000 руб.',
  auctionDate: 'Аукцион состоится 24.03.2026',
};

/** Contains SPECIAL_KEYWORD ('заболо') → detected as special listing. */
export const listingSpecial: Listing = {
  link: 'https://gcn.by/3',
  title: 'Участок в д. Заболоть',
  price: '30 000 руб.',
  auctionDate: 'Аукцион состоится 10.04.2026',
};

/** Listing with a sale price already set (as if returned from the archive). */
export const listingBSold: Listing = {
  ...listingB,
  salePrice: '25 тыс. руб.',
};

// ---------------------------------------------------------------------------
// grodnorik.gov.by notices
// ---------------------------------------------------------------------------

export const noticeA: GrodnorikNotice = {
  link: 'https://grodnorik.gov.by/uploads/files/materialy/aukciony/2026/a.pdf',
  title: 'Извещение о проведении 7 августа 2026 г. аукциона',
  auctionDate: '07.08.2026',
};

export const noticeB: GrodnorikNotice = {
  link: 'https://grodnorik.gov.by/uploads/files/materialy/aukciony/2026/b.pdf',
  title: 'Извещение о проведении 28 июля 2026 г. аукциона',
  auctionDate: '28.07.2026',
};

// ---------------------------------------------------------------------------
// Archive pending items
// ---------------------------------------------------------------------------

/** Pending item removed 3 days ago — well within ARCHIVE_PENDING_TTL_DAYS. */
export const pendingRecent: ArchivePendingItem = {
  listing: listingB,
  removedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
};

/** Pending item removed past ARCHIVE_PENDING_TTL_DAYS — should be silently dropped. */
export const pendingExpired: ArchivePendingItem = {
  listing: listingB,
  removedAt: new Date(
    Date.now() - (ARCHIVE_PENDING_TTL_DAYS + 1) * 24 * 60 * 60 * 1000,
  ).toISOString(),
};

// ---------------------------------------------------------------------------
// Sale price maps
// ---------------------------------------------------------------------------

/** Sale price found for listingB. */
export const salePricesB = new Map([[listingB.link!, '25 тыс. руб.']]);
