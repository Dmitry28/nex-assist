import type { CarListing, RemovedCarListing } from './dto/car-listing.dto';
import { EMPTY_VALUES } from './constants';

export const hasValue = (val: string | undefined): val is string => !!val && !EMPTY_VALUES.has(val);

export interface SummaryParams {
  date: Date;
  total: number;
  newCount: number;
  removedCount: number;
  soldUpdateCount: number;
}

export interface CaptionParams {
  listing: CarListing | RemovedCarListing;
  header: string;
  index: number;
  total: number;
}

export const buildSummary = ({
  date,
  total,
  newCount,
  removedCount,
  soldUpdateCount,
}: SummaryParams): string => {
  const lines = [
    `<b>🚗 Сводка на ${date.toLocaleDateString('ru-RU', { timeZone: 'Europe/Minsk' })}</b>`,
    `📋 Всего лотов: <b>${total}</b>`,
    `🆕 Новые: <b>${newCount}</b>`,
    `🗑 Снятые: <b>${removedCount}</b>`,
  ];
  if (soldUpdateCount > 0) {
    lines.push(`💰 Цены продажи найдены: <b>${soldUpdateCount}</b>`);
  }
  return lines.join('\n');
};

export const buildCaption = ({ listing, header, index, total }: CaptionParams): string => {
  const lines: string[] = [
    `<b>${header} · ${index}/${total}</b>`,
    '',
    `🚗 <b>${listing.title ?? 'Без названия'}</b>`,
  ];

  // Show sold price (final) if available, otherwise last known bid/BIN
  const soldPrice = 'soldPrice' in listing ? listing.soldPrice : undefined;
  if (hasValue(soldPrice)) {
    lines.push('', `💰 Продано за: <b>${soldPrice}</b>`);
  } else {
    if (hasValue(listing.currentBid)) lines.push('', `💰 Ставка: ${listing.currentBid}`);
    if (hasValue(listing.buyNow)) lines.push(`🛒 <b>Купить сейчас: ${listing.buyNow}</b>`);
  }

  // Damage + running condition + document type
  if (hasValue(listing.damage)) lines.push('', `💥 ${listing.damage}`);
  if (hasValue(listing.condition)) lines.push(`🚦 ${listing.condition}`);
  if (hasValue(listing.keys)) lines.push(`📄 ${listing.keys}`);

  // Odometer + engine + location + date
  if (hasValue(listing.odometer)) lines.push('', `📏 ${listing.odometer}`);
  if (hasValue(listing.engine)) lines.push(`🔧 ${listing.engine}`);
  if (hasValue(listing.location)) lines.push(`📍 ${listing.location}`);
  if (hasValue(listing.auctionDate)) lines.push(`🗓 ${listing.auctionDate}`);

  // Auction source + seller
  if (hasValue(listing.auctionSource) || hasValue(listing.seller)) {
    lines.push('');
    if (hasValue(listing.auctionSource)) lines.push(`🏛 ${listing.auctionSource}`);
    if (hasValue(listing.seller)) lines.push(`👤 ${listing.seller}`);
  }

  // Identifiers
  if (hasValue(listing.lot)) lines.push('', `Лот: ${listing.lot}`);
  if (hasValue(listing.vin)) lines.push(`VIN: <code>${listing.vin}</code>`);

  lines.push('', `<a href="${listing.link}">🔗 Подробнее</a>`);

  return lines.join('\n');
};
