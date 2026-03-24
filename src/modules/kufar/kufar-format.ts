import type { KufarFeedResult, KufarListing, KufarPriceChange } from './dto/kufar-listing.dto';
import { EMPTY_VALUES, FEED_DISPLAY_NAMES, MAX_PRICE_CHANGES_IN_SUMMARY } from './constants';

export const hasValue = (val: string | number | undefined): val is string | number =>
  val !== undefined && val !== null && !EMPTY_VALUES.has(String(val));

export const formatDate = (isoString: string): string => {
  const date = new Date(isoString);
  const now = new Date();
  const diffH = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

  if (diffH < 24) {
    return `сегодня ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Minsk' })}`;
  }
  if (diffH < 48) {
    return `вчера ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Minsk' })}`;
  }
  return date.toLocaleDateString('ru-RU', { timeZone: 'Europe/Minsk' });
};

export const formatPrice = (byn?: number, usd?: number): string => {
  const parts: string[] = [];
  if (byn !== undefined && byn > 0) parts.push(`${byn.toLocaleString('ru-RU')} BYN`);
  if (usd !== undefined && usd > 0) parts.push(`$${usd.toLocaleString('ru-RU')}`);
  return parts.join(' / ');
};

export interface ListingCaptionParams {
  listing: KufarListing;
  header: string;
  index: number;
  total: number;
}

export interface PriceChangeCaptionParams {
  change: KufarPriceChange;
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
  if (hasValue(listing.propertyType)) lines.push(`🏷 ${listing.propertyType}`);

  lines.push(`💰 ${formatPrice(listing.priceByn, listing.priceUsd) || 'Договорная'}`);
  if (hasValue(listing.area)) lines.push(`📐 ${listing.area} м²`);
  if (hasValue(listing.plotArea)) lines.push(`🌱 ${listing.plotArea} сот.`);
  if (hasValue(listing.rooms)) lines.push(`🚪 ${listing.rooms} комн.`);
  if (hasValue(listing.yearBuilt)) lines.push(`📅 ${listing.yearBuilt} г.п.`);
  if (listing.features && listing.features.length > 0)
    lines.push(`✅ ${listing.features.join(', ')}`);
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

  const oldPrice = formatPrice(oldPriceByn, oldPriceUsd) || 'Договорная';
  const newPrice = formatPrice(listing.priceByn, listing.priceUsd) || 'Договорная';
  lines.push(`💰 ${oldPrice} → <b>${newPrice}</b>`);

  if (hasValue(listing.area)) lines.push(`📐 ${listing.area} м²`);
  if (hasValue(listing.plotArea)) lines.push(`🌱 ${listing.plotArea} сот.`);
  if (hasValue(listing.rooms)) lines.push(`🚪 ${listing.rooms} комн.`);
  if (hasValue(listing.yearBuilt)) lines.push(`📅 ${listing.yearBuilt} г.п.`);
  lines.push('', `<a href="${listing.link}">🔗 Подробнее</a>`);

  return lines.join('\n');
};

export const buildSummary = (feeds: KufarFeedResult[]): string => {
  const date = new Date().toLocaleDateString('ru-RU');
  const lines = [`<b>🏘 Kufar · ${date}</b>`];

  for (const feed of feeds) {
    const name = FEED_DISPLAY_NAMES[feed.feedName] ?? feed.feedName;
    const parts: string[] = [];
    if (feed.newListings.length > 0) parts.push(`🆕 ${feed.newListings.length} новых`);
    if (feed.priceChanges.length > 0) parts.push(`💸 ${feed.priceChanges.length} изм. цены`);
    const status = parts.length > 0 ? parts.join(', ') : 'без изменений';
    lines.push('', `<b>${name}:</b> ${status}`);

    if (feed.priceChanges.length > 0) {
      const shown = feed.priceChanges.slice(0, MAX_PRICE_CHANGES_IN_SUMMARY);
      for (const { listing, oldPriceByn, oldPriceUsd } of shown) {
        const oldPrice = formatPrice(oldPriceByn, oldPriceUsd) || 'Договорная';
        const newPrice = formatPrice(listing.priceByn, listing.priceUsd) || 'Договорная';
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
