import { LOCALE, TIMEZONE } from '../../common/utils/locale';
import { NOTIFICATION_HEADERS } from './constants';
import type { KufarRentLongListing, KufarRentLongResult } from './dto/kufar-rent-long-listing.dto';

const NEGOTIABLE_PRICE = 'Договорная';

const formatPrice = (listing: KufarRentLongListing): string => {
  const parts: string[] = [];
  if (listing.priceUsd && listing.priceUsd > 0) {
    parts.push(`${listing.priceUsd.toLocaleString(LOCALE)} USD`);
  }
  if (listing.priceByn && listing.priceByn > 0) {
    parts.push(`${listing.priceByn.toLocaleString(LOCALE)} BYN`);
  }
  return parts.length > 0 ? `${parts.join(' / ')} / мес.` : '';
};

const characteristicsLines = (listing: KufarRentLongListing): string[] => {
  const lines: string[] = [];
  if (listing.rooms) lines.push(`🚪 ${listing.rooms} комн.`);
  if (listing.area) lines.push(`📐 ${listing.area} м²`);
  if (listing.floor && listing.totalFloors) {
    lines.push(`🏢 ${listing.floor} / ${listing.totalFloors} эт.`);
  } else if (listing.floor) {
    lines.push(`🏢 ${listing.floor} эт.`);
  }
  if (listing.repair) lines.push(`🔨 ${listing.repair}`);
  if (listing.furnished) lines.push(`🛋 ${listing.furnished}`);
  if (listing.prepayment) lines.push(`💳 предоплата: ${listing.prepayment}`);
  return lines;
};

export interface ListingCaptionParams {
  listing: KufarRentLongListing;
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
  const price = formatPrice(listing) || NEGOTIABLE_PRICE;

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

export const buildSummary = (result: KufarRentLongResult, sourceUrl?: string): string => {
  const date = new Date().toLocaleDateString(LOCALE, { timeZone: TIMEZONE });
  const lines = [`<b>🏘 Kufar · аренда квартиры · Гродно · ${date}</b>`];

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

  if (sourceUrl) lines.push('', `<a href="${sourceUrl}">🔗 Источник (re.kufar.by)</a>`);

  return lines.join('\n');
};

export const HEADERS = NOTIFICATION_HEADERS;
