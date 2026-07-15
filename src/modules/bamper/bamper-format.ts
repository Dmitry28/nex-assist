import { LOCALE, TIMEZONE } from '../../common/utils/locale';
import { NOTIFICATION_HEADER } from './constants';
import type { BamperListing, BamperResult } from './dto/bamper-listing.dto';

const PRICE_ON_REQUEST = 'Цена по запросу';

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
  index: number;
  total: number;
}

/** Max seller-note length shown in a caption — keeps within Telegram's 1024-char limit. */
const DESCRIPTION_LIMIT = 220;

export const buildListingCaption = ({ listing, index, total }: ListingCaptionParams): string => {
  const lines: string[] = [
    `<b>${NOTIFICATION_HEADER} · ${index}/${total}</b>`,
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

export const buildSummary = (result: BamperResult): string => {
  const date = new Date().toLocaleDateString(LOCALE, { timeZone: TIMEZONE });
  const lines = [`<b>🔧 bamper.by · задний бампер Atlas Cross Sport · ${date}</b>`];

  if (result.isBaseline) {
    lines.push('', `🏗 baseline · ${result.total} объявл. сохранено`);
    return lines.join('\n');
  }

  lines.push('', `Всего в выдаче: <b>${result.total}</b>`);
  lines.push(
    result.newListings.length > 0
      ? `🆕 ${result.newListings.length} новых`
      : 'без новых объявлений',
  );
  return lines.join('\n');
};
