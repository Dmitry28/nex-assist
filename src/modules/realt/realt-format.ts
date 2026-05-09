import { LOCALE, TIMEZONE } from '../../common/utils/locale';
import { EMPTY_VALUES, FEED_DISPLAY_NAMES, MAX_PRICE_CHANGES_IN_SUMMARY } from './constants';
import type { RealtFeedResult, RealtListing, RealtPriceChange } from './dto/realt-listing.dto';

const NEGOTIABLE_PRICE = 'Договорная';

export const hasValue = (val: string | number | undefined): val is string | number =>
  val !== undefined && val !== null && !EMPTY_VALUES.has(String(val));

export const formatDate = (isoString: string): string => {
  const date = new Date(isoString);
  const now = new Date();
  const diffH = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

  if (diffH < 24) {
    return `сегодня ${date.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', timeZone: TIMEZONE })}`;
  }
  if (diffH < 48) {
    return `вчера ${date.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', timeZone: TIMEZONE })}`;
  }
  return date.toLocaleDateString(LOCALE, { timeZone: TIMEZONE });
};

export const formatPrice = (byn?: number, usd?: number): string => {
  const parts: string[] = [];
  if (byn !== undefined && byn > 0) parts.push(`${byn.toLocaleString(LOCALE)} BYN`);
  if (usd !== undefined && usd > 0) parts.push(`$${usd.toLocaleString(LOCALE)}`);
  return parts.join(' / ');
};

export interface ListingCaptionParams {
  listing: RealtListing;
  header: string;
  index: number;
  total: number;
}

export interface PriceChangeCaptionParams {
  change: RealtPriceChange;
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
  ];

  if (hasValue(listing.description)) lines.push(`<i>${listing.description}</i>`);

  lines.push('');
  if (hasValue(listing.address)) lines.push(`📍 ${listing.address}`);
  lines.push(`💰 ${formatPrice(listing.priceByn, listing.priceUsd) || NEGOTIABLE_PRICE}`);
  if (hasValue(listing.area)) lines.push(`📐 ${listing.area} м²`);
  if (hasValue(listing.areaLiving) || hasValue(listing.areaKitchen)) {
    const parts: string[] = [];
    if (hasValue(listing.areaLiving)) parts.push(`жил. ${listing.areaLiving} м²`);
    if (hasValue(listing.areaKitchen)) parts.push(`кух. ${listing.areaKitchen} м²`);
    lines.push(`🏠 ${parts.join(' / ')}`);
  }
  if (hasValue(listing.plotArea)) lines.push(`🌱 ${listing.plotArea} сот.`);
  if (hasValue(listing.rooms)) lines.push(`🚪 ${listing.rooms} комн.`);
  if (hasValue(listing.yearBuilt)) lines.push(`📅 ${listing.yearBuilt} г.п.`);
  if (hasValue(listing.storeys)) lines.push(`🏢 ${listing.storeys} эт.`);
  if (hasValue(listing.levels) && listing.levels !== listing.storeys)
    lines.push(`🪜 ${listing.levels} уровн.`);
  if (hasValue(listing.seller)) lines.push(`👤 ${listing.seller}`);

  lines.push(`🕐 ${formatDate(listing.listTime)}`);
  lines.push('', `<a href="${listing.link}">🔗 Подробнее</a>`);

  return lines.join('\n');
};

export const buildPriceChangeCaption = ({
  change,
  header,
  index,
  total,
}: PriceChangeCaptionParams): string => {
  const { listing, oldPriceByn, oldPriceUsd } = change;
  const lines: string[] = [
    `<b>${header} · ${index}/${total}</b>`,
    '',
    `🏠 <b>${listing.title}</b>`,
  ];

  if (hasValue(listing.address)) lines.push(`📍 ${listing.address}`);

  const oldPrice = formatPrice(oldPriceByn, oldPriceUsd) || NEGOTIABLE_PRICE;
  const newPrice = formatPrice(listing.priceByn, listing.priceUsd) || NEGOTIABLE_PRICE;
  lines.push(`💰 ${oldPrice} → <b>${newPrice}</b>`);

  if (hasValue(listing.area)) lines.push(`📐 ${listing.area} м²`);
  if (hasValue(listing.plotArea)) lines.push(`🌱 ${listing.plotArea} сот.`);
  if (hasValue(listing.rooms)) lines.push(`🚪 ${listing.rooms} комн.`);
  if (hasValue(listing.yearBuilt)) lines.push(`📅 ${listing.yearBuilt} г.п.`);
  lines.push('', `<a href="${listing.link}">🔗 Подробнее</a>`);

  return lines.join('\n');
};

export const buildSummary = (feeds: RealtFeedResult[]): string => {
  const date = new Date().toLocaleDateString(LOCALE, { timeZone: TIMEZONE });
  const lines = [`<b>🏘 realt.by · ${date}</b>`];

  for (const feed of feeds) {
    const name = FEED_DISPLAY_NAMES[feed.feedName] ?? feed.feedName;

    if (feed.isBaseline) {
      lines.push(
        '',
        `<b>${name}:</b> 🏗 baseline · ${feed.newListings.length} объявлений сохранено`,
      );
      continue;
    }

    const parts: string[] = [];
    if (feed.newListings.length > 0) parts.push(`🆕 ${feed.newListings.length} новых`);
    if (feed.priceChanges.length > 0) parts.push(`💸 ${feed.priceChanges.length} изм. цены`);
    const status = parts.length > 0 ? parts.join(', ') : 'без изменений';
    lines.push('', `<b>${name}:</b> ${status}`);

    if (feed.priceChanges.length > 0) {
      const shown = feed.priceChanges.slice(0, MAX_PRICE_CHANGES_IN_SUMMARY);
      for (const { listing, oldPriceByn, oldPriceUsd } of shown) {
        const oldPrice = formatPrice(oldPriceByn, oldPriceUsd) || NEGOTIABLE_PRICE;
        const newPrice = formatPrice(listing.priceByn, listing.priceUsd) || NEGOTIABLE_PRICE;
        const shortTitle =
          listing.title.length > 35 ? listing.title.slice(0, 32) + '...' : listing.title;
        lines.push(
          `  • <a href="${listing.link}">${shortTitle}</a>: <s>${oldPrice}</s> → <b>${newPrice}</b>`,
        );
      }
      if (feed.priceChanges.length > MAX_PRICE_CHANGES_IN_SUMMARY) {
        lines.push(`  <i>...и ещё ${feed.priceChanges.length - MAX_PRICE_CHANGES_IN_SUMMARY}</i>`);
      }
    }
  }

  return lines.join('\n');
};
