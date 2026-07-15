import { LOCALE, TIMEZONE } from '../../common/utils/locale';
import type { BamperFeedResult, BamperListing, BamperResult } from './dto/bamper-listing.dto';

const PRICE_ON_REQUEST = 'Цена по запросу';

/** Max seller-note length shown in a caption — keeps within Telegram's 1024-char limit. */
const DESCRIPTION_LIMIT = 220;

/** "1519 $ · 4350 р." — whichever prices are present. */
export const formatPrice = (listing: BamperListing): string => {
  const parts: string[] = [];
  if (listing.priceUsd && listing.priceUsd > 0) {
    parts.push(`${listing.priceUsd.toLocaleString(LOCALE)} $`);
  }
  if (listing.priceByn && listing.priceByn > 0) {
    parts.push(`${listing.priceByn.toLocaleString(LOCALE)} р.`);
  }
  return parts.length > 0 ? parts.join(' · ') : PRICE_ON_REQUEST;
};

export interface ListingCaptionParams {
  listing: BamperListing;
  feedLabel: string;
  index: number;
  total: number;
}

export const buildListingCaption = ({
  listing,
  feedLabel,
  index,
  total,
}: ListingCaptionParams): string => {
  const lines: string[] = [
    `<b>🆕 ${feedLabel} · Atlas Cross Sport · ${index}/${total}</b>`,
    '',
    `🚗 <b>${listing.title}</b>`,
    '',
    `💰 ${formatPrice(listing)}`,
  ];
  if (listing.year) lines.push(`📅 ${listing.year} г.`);
  const place = [listing.city, listing.sellerRating && `⭐ ${listing.sellerRating}`]
    .filter(Boolean)
    .join(' · ');
  if (place) lines.push(`📍 ${place}`);
  if (listing.description) {
    const text =
      listing.description.length > DESCRIPTION_LIMIT
        ? `${listing.description.slice(0, DESCRIPTION_LIMIT).trimEnd()}…`
        : listing.description;
    lines.push('', `📝 ${text}`);
  }
  lines.push('', `<a href="${listing.url}">🔗 Подробнее</a>`);
  return lines.join('\n');
};

/** One line per feed for the run summary. */
const feedSummaryLine = (feed: BamperFeedResult): string => {
  if (feed.isBaseline) return `• ${feed.label}: 🏗 baseline · ${feed.total} сохранено`;
  const bits = [`всего ${feed.total}`];
  if (feed.newListings.length > 0) bits.unshift(`🆕 ${feed.newListings.length} нов.`);
  return `• ${feed.label}: ${bits.join(' · ')}`;
};

export const buildSummary = (result: BamperResult): string => {
  const date = new Date().toLocaleDateString(LOCALE, { timeZone: TIMEZONE });
  const lines = [`<b>🔧 bamper.by · Atlas Cross Sport · ${date}</b>`, ''];
  for (const feed of result.feeds) lines.push(feedSummaryLine(feed));
  return lines.join('\n');
};
