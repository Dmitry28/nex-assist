import { LOCALE, TIMEZONE } from '../../common/utils/locale';
import type { RazborfListing, RazborfResult } from './dto/razborf-listing.dto';

const PRICE_ON_REQUEST = 'Цена по запросу';

/** Max seller-note length shown in a caption — keeps within Telegram's 1024-char limit. */
const DESCRIPTION_LIMIT = 220;

export const formatPrice = (listing: RazborfListing): string =>
  listing.priceByn && listing.priceByn > 0
    ? `${listing.priceByn.toLocaleString(LOCALE)} р.`
    : PRICE_ON_REQUEST;

export interface ListingCaptionParams {
  listing: RazborfListing;
  index: number;
  total: number;
}

export const buildListingCaption = ({ listing, index, total }: ListingCaptionParams): string => {
  const lines: string[] = [
    `<b>🆕 Atlas · ${listing.part} · ${index}/${total}</b>`,
    '',
    `🚗 <b>${listing.title}</b>`,
    '',
    `💰 ${formatPrice(listing)}`,
  ];
  if (listing.year) lines.push(`📅 ${listing.year} г.`);
  if (listing.carSpec) lines.push(`⚙️ ${listing.carSpec}`);
  lines.push('📍 razborf.by · Минск');
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

export const buildSummary = (result: RazborfResult, modelUrl: string): string => {
  const date = new Date().toLocaleDateString(LOCALE, { timeZone: TIMEZONE });
  const bits = [`в наличии: ${result.total}`];
  if (result.newListings.length > 0) bits.unshift(`🆕 ${result.newListings.length} нов.`);
  const lines = [
    `<b>🔩 razborf.by · запчасти Atlas · ${date}</b>`,
    '',
    `• <a href="${modelUrl}">Atlas restailing 2</a>: ${bits.join(' · ')}`,
  ];
  if (result.categories.length > 0) lines.push(`  ${result.categories.join(', ')}`);
  if (result.failedCategories.length > 0) {
    lines.push('', `⚠️ Не удалось проверить: ${result.failedCategories.join(', ')}`);
  }
  return lines.join('\n');
};
