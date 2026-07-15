import { LOCALE, TIMEZONE } from '../../common/utils/locale';
import type { GhbListing, GhbResult } from './dto/ghb-listing.dto';

const TYPE_LABEL: Record<GhbListing['type'], string> = {
  apartment: '🏠',
  office: '🏢',
};

const formatPriceRangeByn = (min?: number, max?: number): string | undefined => {
  const lo = min ?? max;
  const hi = max ?? min;
  if (lo === undefined || hi === undefined) return undefined;
  if (lo === hi) return `${lo.toLocaleString(LOCALE)} BYN / м²`;
  return `${lo.toLocaleString(LOCALE)}–${hi.toLocaleString(LOCALE)} BYN / м²`;
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

/** Monitored ghb.by source URLs — surfaced as links in the summary. */
export interface GhbSummarySources {
  priceListUrl?: string;
  apartmentsPageUrl?: string;
}

export const buildSummary = (result: GhbResult, sources: GhbSummarySources = {}): string => {
  const date = new Date().toLocaleDateString(LOCALE, { timeZone: TIMEZONE });
  const lines = [`<b>🏗 ghb.by · ${date}</b>`];

  if (result.isBaseline) {
    lines.push('', `🏗 baseline · ${result.total} объект(ов) сохранено`);
  } else {
    lines.push('', `Всего в прейскуранте: <b>${result.total}</b>`);
    lines.push(
      result.newListings.length > 0 ? `🆕 ${result.newListings.length} нов(ых)` : 'без изменений',
    );
  }

  const sourceLines: string[] = [];
  if (sources.priceListUrl)
    sourceLines.push(`<a href="${sources.priceListUrl}">🔗 Прейскурант</a>`);
  if (sources.apartmentsPageUrl)
    sourceLines.push(`<a href="${sources.apartmentsPageUrl}">🔗 Квартиры</a>`);
  if (sourceLines.length) lines.push('', 'Источники:', ...sourceLines);

  return lines.join('\n');
};
