import { LOCALE, TIMEZONE } from '../../common/utils/locale';
import { NOTIFICATION_HEADERS } from './constants';
import type { KufarRentFlatListing, KufarRentFlatResult } from './dto/kufar-rent-flat-listing.dto';

const NEGOTIABLE_PRICE = 'Цена не указана';

const formatPrice = (value: number | undefined): string => {
  if (value === undefined || value <= 0) return '';
  return `${value.toLocaleString(LOCALE)} BYN / сутки`;
};

const characteristicsLines = (listing: KufarRentFlatListing): string[] => {
  const lines: string[] = [];
  if (listing.accommodationType) lines.push(`🏷 ${listing.accommodationType}`);
  if (listing.rooms) lines.push(`🚪 ${listing.rooms} комн.`);
  if (listing.personsMax) lines.push(`👥 до ${listing.personsMax} гост.`);
  if (listing.area) lines.push(`📐 ${listing.area} м²`);
  if (listing.isSuperhost) lines.push('⭐ Суперхозяин');
  if (listing.rating && listing.ratingScoresCount) {
    lines.push(`⭐ ${listing.rating.toFixed(1)} (${listing.ratingScoresCount} отз.)`);
  }
  return lines;
};

export interface ListingCaptionParams {
  listing: KufarRentFlatListing;
  header: string;
  index: number;
  total: number;
}

export const buildListingCaption = ({
  listing,
  header,
  index,
  total,
}: ListingCaptionParams): string => {
  const price = formatPrice(listing.pricePerNightByn) || NEGOTIABLE_PRICE;

  const lines: string[] = [
    `<b>${header} · ${index}/${total}</b>`,
    '',
    `🏠 <b>${listing.title}</b>`,
  ];
  if (listing.address) lines.push(`📍 ${listing.address}`);
  lines.push('', `💰 ${price}`);
  lines.push(...characteristicsLines(listing));
  lines.push('', `<a href="${listing.link}">🔗 Подробнее</a>`);

  return lines.join('\n');
};

export const buildSummary = (result: KufarRentFlatResult, sourceUrl?: string): string => {
  const date = new Date().toLocaleDateString(LOCALE, { timeZone: TIMEZONE });
  const lines = [`<b>🛏 Kufar Travel · Гродно · ${date}</b>`];

  if (result.isBaseline) {
    lines.push('', `🏗 baseline · ${result.total} вариант(ов) сохранено`);
  } else {
    lines.push('', `Найдено вариантов: <b>${result.total}</b>`);
    lines.push(
      result.newListings.length > 0
        ? `🆕 ${result.newListings.length} новых`
        : 'без новых вариантов',
    );
  }

  if (sourceUrl) lines.push('', `<a href="${sourceUrl}">🔗 Источник (travel.kufar.by)</a>`);

  return lines.join('\n');
};

export const HEADERS = NOTIFICATION_HEADERS;
