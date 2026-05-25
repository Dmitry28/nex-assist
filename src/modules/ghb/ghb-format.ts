import { LOCALE, TIMEZONE } from '../../common/utils/locale';
import { NOTIFICATION_HEADERS } from './constants';
import type { GhbListing, GhbResult } from './dto/ghb-listing.dto';

const TYPE_LABEL: Record<GhbListing['type'], string> = {
  apartment: '🏠',
  office: '🏢',
};

const formatPriceRangeByn = (min?: number, max?: number): string | undefined => {
  if (min === undefined && max === undefined) return undefined;
  if (min !== undefined && max !== undefined && min !== max) {
    return `${min.toLocaleString(LOCALE)}–${max.toLocaleString(LOCALE)} BYN / м²`;
  }
  const value = (min ?? max)!;
  return `${value.toLocaleString(LOCALE)} BYN / м²`;
};

export interface ListingCaptionParams {
  listing: GhbListing;
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
  const icon = TYPE_LABEL[listing.type];
  const price = formatPriceRangeByn(listing.minPricePerM2Byn, listing.maxPricePerM2Byn);

  const lines: string[] = [
    `<b>${header} · ${index}/${total}</b>`,
    '',
    `${icon} <b>${listing.title}</b>`,
  ];
  if (price) lines.push('', `💵 ${price}`);
  if (listing.onlineRegistration) lines.push(`📅 ${listing.onlineRegistration}`);
  lines.push('', `<a href="${listing.url}">🔗 Подробнее</a>`);

  return lines.join('\n');
};

export const buildSummary = (result: GhbResult): string => {
  const date = new Date().toLocaleDateString(LOCALE, { timeZone: TIMEZONE });
  const lines = [`<b>🏗 ghb.by · ${date}</b>`];

  if (result.isBaseline) {
    lines.push('', `🏗 baseline · ${result.total} объект(ов) сохранено`);
    return lines.join('\n');
  }

  lines.push('', `Всего в прейскуранте: <b>${result.total}</b>`);
  lines.push(
    result.newListings.length > 0 ? `🆕 ${result.newListings.length} нов(ых)` : 'без изменений',
  );

  return lines.join('\n');
};

export const HEADERS = NOTIFICATION_HEADERS;
