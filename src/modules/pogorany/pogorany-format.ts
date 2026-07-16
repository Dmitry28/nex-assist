import { LOCALE, TIMEZONE } from '../../common/utils/locale';
import { NOTIFICATION_HEADERS } from './constants';
import type {
  PogoranyListing,
  PogoranyPriceChange,
  PogoranyResult,
} from './dto/pogorany-listing.dto';

const NEGOTIABLE_PRICE = 'Договорная';

export const formatPrice = (value: number | undefined, currency: string | undefined): string => {
  if (value === undefined || value <= 0) return '';
  const formatted = value.toLocaleString(LOCALE);
  return currency ? `${formatted} ${currency}` : formatted;
};

export interface ListingCaptionParams {
  listing: PogoranyListing;
  header: string;
  index: number;
  total: number;
}

export interface PriceChangeCaptionParams {
  change: PogoranyPriceChange;
  header: string;
  index: number;
  total: number;
}

const characteristicsLines = (listing: PogoranyListing): string[] => {
  const lines: string[] = [];
  if (listing.area) lines.push(`📐 ${listing.area}`);
  if (listing.rooms) lines.push(`🚪 ${listing.rooms} комн.`);
  if (listing.bathrooms) lines.push(`🚿 ${listing.bathrooms} с/у`);
  if (listing.ceilingHeight) lines.push(`📏 потолки ${listing.ceilingHeight}`);
  if (listing.plotArea) lines.push(`🌱 участок ${listing.plotArea}`);
  if (listing.parking) lines.push(`🅿️ ${listing.parking} м/м`);
  return lines;
};

export const buildListingCaption = ({
  listing,
  header,
  index,
  total,
}: ListingCaptionParams): string => {
  const price = formatPrice(listing.price, listing.currency) || NEGOTIABLE_PRICE;
  const pricePerM2 = formatPrice(listing.pricePerM2, listing.pricePerM2Currency);

  const lines: string[] = [
    `<b>${header} · ${index}/${total}</b>`,
    '',
    `🏠 <b>${listing.title}</b>`,
    '',
    `💰 ${price}`,
  ];
  if (pricePerM2) lines.push(`💵 ${pricePerM2} / м²`);
  lines.push(...characteristicsLines(listing));
  lines.push('', `<a href="${listing.link}">🔗 Подробнее</a>`);

  return lines.join('\n');
};

export const buildPriceChangeCaption = ({
  change,
  header,
  index,
  total,
}: PriceChangeCaptionParams): string => {
  const { listing, oldPrice, oldCurrency } = change;
  const oldFormatted = formatPrice(oldPrice, oldCurrency) || NEGOTIABLE_PRICE;
  const newFormatted = formatPrice(listing.price, listing.currency) || NEGOTIABLE_PRICE;

  const lines: string[] = [
    `<b>${header} · ${index}/${total}</b>`,
    '',
    `🏠 <b>${listing.title}</b>`,
    '',
    `💰 <s>${oldFormatted}</s> → <b>${newFormatted}</b>`,
  ];
  lines.push(...characteristicsLines(listing));
  lines.push('', `<a href="${listing.link}">🔗 Подробнее</a>`);

  return lines.join('\n');
};

export const buildRemovedCaption = ({
  listing,
  header,
  index,
  total,
}: ListingCaptionParams): string => {
  const price = formatPrice(listing.price, listing.currency) || NEGOTIABLE_PRICE;
  return [
    `<b>${header} · ${index}/${total}</b>`,
    '',
    `🏠 <b>${listing.title}</b>`,
    `💰 ${price} (последняя известная цена)`,
    '',
    `<a href="${listing.link}">🔗 Ссылка</a>`,
  ].join('\n');
};

export const buildSummary = (result: PogoranyResult, sourceUrl?: string): string => {
  const date = new Date().toLocaleDateString(LOCALE, { timeZone: TIMEZONE });
  const lines = [`<b>🏘 pogorany.by · ${date}</b>`];

  if (result.isBaseline) {
    lines.push('', `🏗 baseline · ${result.total} лот(ов) сохранено`);
  } else {
    const parts: string[] = [];
    if (result.newListings.length > 0) parts.push(`🆕 ${result.newListings.length} новых`);
    if (result.removedListings.length > 0) parts.push(`🚫 ${result.removedListings.length} снято`);
    if (result.priceChanges.length > 0) parts.push(`💸 ${result.priceChanges.length} изм. цены`);

    lines.push('', `Всего в каталоге: <b>${result.total}</b>`);
    lines.push(parts.length > 0 ? parts.join(' · ') : 'без изменений');
  }

  if (sourceUrl) lines.push('', `<a href="${sourceUrl}">🔗 Источник (pogorany.by)</a>`);

  return lines.join('\n');
};

export const HEADERS = NOTIFICATION_HEADERS;
