import { LOCALE } from '../../common/utils/locale';
import {
  MAX_PRICE_CHANGES_IN_SUMMARY,
  NOTIFICATION_HEADERS,
  SOURCE_DISPLAY_NAMES,
} from './constants';
import type {
  TownhouseListing,
  TownhousePriceChange,
  TownhousesResult,
} from './dto/townhouse-listing.dto';

const NEGOTIABLE_PRICE = 'Договорная';

const num = (value: number): string => value.toLocaleString(LOCALE);

/**
 * Sources quote different currencies — prometr BYN only, kufar and realt both — so show
 * whatever exists rather than forcing one.
 */
export const formatPrice = (listing: { priceUsd?: number; priceByn?: number }): string => {
  const parts: string[] = [];
  if (listing.priceUsd && listing.priceUsd > 0) parts.push(`${num(listing.priceUsd)} $`);
  if (listing.priceByn && listing.priceByn > 0) parts.push(`${num(listing.priceByn)} BYN`);
  return parts.join(' · ') || NEGOTIABLE_PRICE;
};

const characteristics = (listing: TownhouseListing): string[] => {
  const lines: string[] = [];
  if (listing.area) lines.push(`📐 ${listing.area} м²`);
  if (listing.rooms) lines.push(`🚪 ${listing.rooms} комн.`);
  if (listing.plotArea) lines.push(`🌱 участок ${listing.plotArea} сот.`);
  if (listing.pricePerM2Byn) lines.push(`💵 ${num(listing.pricePerM2Byn)} BYN / м²`);
  if (listing.address) lines.push(`📍 ${listing.address}`);
  return lines;
};

const sourceLabel = (listing: TownhouseListing): string =>
  listing.complex ?? SOURCE_DISPLAY_NAMES[listing.source] ?? listing.source;

export interface ListingCaptionParams {
  listing: TownhouseListing;
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
  const lines: string[] = [
    `<b>${header} · ${index}/${total}</b>`,
    '',
    `🏠 <b>${listing.title}</b>`,
    '',
    `💰 ${formatPrice(listing)}`,
    ...characteristics(listing),
    `🏷 ${sourceLabel(listing)}`,
    '',
    `<a href="${listing.link}">🔗 Подробнее</a>`,
  ];
  return lines.join('\n');
};

export interface PriceChangeCaptionParams {
  change: TownhousePriceChange;
  header: string;
  index: number;
  total: number;
}

export const buildPriceChangeCaption = ({
  change,
  header,
  index,
  total,
}: PriceChangeCaptionParams): string => {
  const { listing, oldPriceByn, oldPriceUsd } = change;
  const before = formatPrice({ priceUsd: oldPriceUsd, priceByn: oldPriceByn });
  const after = formatPrice(listing);

  return [
    `<b>${header} · ${index}/${total}</b>`,
    '',
    `🏠 <b>${listing.title}</b>`,
    '',
    `💰 ${before} → <b>${after}</b>`,
    ...characteristics(listing),
    `🏷 ${sourceLabel(listing)}`,
    '',
    `<a href="${listing.link}">🔗 Подробнее</a>`,
  ].join('\n');
};

export const buildSummary = (result: TownhousesResult): string => {
  const lines: string[] = ['<b>🏘 Таунхаусы Гродно</b>', ''];

  for (const s of result.sources) {
    const name = SOURCE_DISPLAY_NAMES[s.source] ?? s.source;
    // A failed source is called out rather than shown as 0 — otherwise a broken site is
    // indistinguishable from a site with nothing on it.
    lines.push(s.failed ? `⚠️ ${name}: источник недоступен` : `• ${name}: ${s.total}`);
  }

  lines.push('', `Всего в базе: ${result.total}`);

  if (result.isBaseline) {
    lines.push('', 'ℹ️ Первый запуск — каталог сохранён, объявления не рассылались.');
    return lines.join('\n');
  }

  lines.push(
    '',
    `${NOTIFICATION_HEADERS.new}: ${result.newListings.length}`,
    `${NOTIFICATION_HEADERS.priceChange}: ${result.priceChanges.length}`,
  );

  for (const change of result.priceChanges.slice(0, MAX_PRICE_CHANGES_IN_SUMMARY)) {
    const before = formatPrice({
      priceUsd: change.oldPriceUsd,
      priceByn: change.oldPriceByn,
    });
    lines.push(`• ${change.listing.title}: ${before} → ${formatPrice(change.listing)}`);
  }
  if (result.priceChanges.length > MAX_PRICE_CHANGES_IN_SUMMARY) {
    lines.push(`…и ещё ${result.priceChanges.length - MAX_PRICE_CHANGES_IN_SUMMARY}`);
  }

  return lines.join('\n');
};
