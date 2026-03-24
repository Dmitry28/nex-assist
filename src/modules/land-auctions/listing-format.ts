import type { Listing } from './dto/listing.dto';
import { EMPTY_VALUES, MAX_AUCTION_DATE_LENGTH } from './constants';

export const hasValue = (val: string | undefined): val is string => !!val && !EMPTY_VALUES.has(val);

export interface SummaryParams {
  date: Date;
  total: number;
  newCount: number;
  removedCount: number;
  specialCount: number;
  newSpecialCount: number;
}

export interface CaptionParams {
  listing: Listing;
  header: string;
  index: number;
  total: number;
}

export const buildSummary = ({
  date,
  total,
  newCount,
  removedCount,
  specialCount,
  newSpecialCount,
}: SummaryParams): string =>
  [
    `<b>📊 Сводка на ${date.toLocaleDateString('ru-RU')}</b>`,
    `📋 Всего объявлений: <b>${total}</b>`,
    `🆕 Новые: <b>${newCount}</b>`,
    `🗑 Удалённые: <b>${removedCount}</b>`,
    `🌿 Всего в Заболоть: <b>${specialCount}</b>`,
    `✅ Новые в Заболоть: <b>${newSpecialCount}</b>`,
  ].join('\n');

export const getListingEmoji = (title: string | undefined): string => {
  if (!title) return '🏡';
  const t = title.toLowerCase();
  if (t.includes('не завершён') || t.includes('незавершён')) return '🏗';
  if (t.includes('жилой дом') || t.includes('дом по')) return '🏠';
  return '🏡';
};

export const formatAuctionDate = (val: string): string => {
  if (val.startsWith('Аукцион состоится ')) return val.replace('Аукцион состоится ', '');
  if (val.startsWith('Проведение аукциона планируется '))
    return val.replace('Проведение аукциона планируется ', '');
  if (val.length > MAX_AUCTION_DATE_LENGTH) return 'уточняется';
  return val;
};

export const formatDeadline = (val: string): string => val.replace('Заявления принимаются по ', '');

export const shortenCommunications = (val: string): string =>
  val
    .replace(/электроснабжение/gi, 'свет')
    .replace(/газоснабжение/gi, 'газ')
    .replace(/водоснабжение/gi, 'вода')
    .replace(/водоотведение/gi, 'канализация')
    .replace(/теплоснабжение/gi, 'тепло');

export const buildCaption = ({ listing, header, index, total }: CaptionParams): string => {
  const emoji = getListingEmoji(listing.title);

  const lines: string[] = [
    `<b>${header} · ${index}/${total}</b>`,
    '',
    `${emoji} <b>${listing.title}</b>`,
  ];

  // Block 2 — location + price/area
  const locationBlock: string[] = [];
  if (hasValue(listing.address)) locationBlock.push(`📍 ${listing.address}`);
  const pricePart = hasValue(listing.price) ? `💰 ${listing.price}` : '';
  const areaPart = hasValue(listing.area) ? `📐 ${listing.area}` : '';
  if (pricePart || areaPart)
    locationBlock.push([pricePart, areaPart].filter(Boolean).join('  ·  '));
  if (locationBlock.length) lines.push('', ...locationBlock);

  // Block 3 — dates + communications
  const infoBlock: string[] = [];
  const auctionPart = hasValue(listing.auctionDate)
    ? `🗓 ${formatAuctionDate(listing.auctionDate)}`
    : '';
  const deadlinePart = hasValue(listing.applicationDeadline)
    ? `📅 до ${formatDeadline(listing.applicationDeadline)}`
    : '';
  if (auctionPart || deadlinePart)
    infoBlock.push([auctionPart, deadlinePart].filter(Boolean).join('  ·  '));
  if (hasValue(listing.communications))
    infoBlock.push(`⚡ ${shortenCommunications(listing.communications)}`);
  if (infoBlock.length) lines.push('', ...infoBlock);

  // Block 4 — links
  const linkParts: string[] = [`<a href="${listing.link}">🔗 Подробнее</a>`];
  if (listing.cadastralMapUrl) linkParts.push(`<a href="${listing.cadastralMapUrl}">📌 Карта</a>`);
  lines.push('', linkParts.join('  ·  '));

  return lines.join('\n');
};
