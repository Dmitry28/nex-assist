import { LOCALE, TIMEZONE } from '../../common/utils/locale';
import type {
  AvByFeedResult,
  AvByListing,
  AvByPriceChange,
  AvByResult,
  RemovedAvByListing,
} from './dto/av-by-listing.dto';
import { NOTIFICATION_HEADERS } from './constants';

const fmtUsd = (n: number): string => `$${n.toLocaleString(LOCALE)}`;
const fmtByn = (n: number): string => `${n.toLocaleString(LOCALE)} р.`;
const fmtKm = (n?: number): string | undefined =>
  n === undefined ? undefined : `${n.toLocaleString(LOCALE)} км`;

export const buildSummary = (result: AvByResult, date: Date): string => {
  const lines: string[] = [
    `<b>🚙 av.by · сводка ${date.toLocaleDateString(LOCALE, { timeZone: TIMEZONE })}</b>`,
  ];
  for (const feed of result.feeds) {
    const parts = [
      `📋 ${feed.total}`,
      `🆕 ${feed.newListings.length}`,
      `💸 ${feed.priceChanges.length}`,
      `✅ ${feed.soldListings.length}`,
    ];
    const baseline = feed.isBaseline ? ' · baseline' : '';
    lines.push(`<b>${feed.label}</b>: ${parts.join(' · ')}${baseline}`);
  }
  return lines.join('\n');
};

const formatListingBlock = (l: AvByListing): string[] => {
  const lines: string[] = [`🚗 <b>${l.title}</b>`];
  const priceUsd = l.priceUsd ? fmtUsd(l.priceUsd) : undefined;
  const priceByn = l.priceByn ? fmtByn(l.priceByn) : undefined;
  const priceLine = [priceUsd, priceByn].filter(Boolean).join(' · ');
  if (priceLine) lines.push(`💰 <b>${priceLine}</b>`);

  const spec = [fmtKm(l.mileageKm), l.engineCapacity, l.engineType, l.transmission, l.bodyType]
    .filter(Boolean)
    .join(' · ');
  if (spec) lines.push(`🔧 ${spec}`);

  const place = [l.location, l.sellerName].filter(Boolean).join(' · ');
  if (place) lines.push(`📍 ${place}`);

  if (l.vinPartial) lines.push(`VIN: <code>${l.vinPartial}</code>`);
  lines.push(`<a href="${l.url}">🔗 Открыть на av.by</a>`);
  return lines;
};

export const buildNewCaption = (
  l: AvByListing,
  feedLabel: string,
  index: number,
  total: number,
): string =>
  [
    `<b>${NOTIFICATION_HEADERS.new} · ${feedLabel} · ${index}/${total}</b>`,
    '',
    ...formatListingBlock(l),
  ].join('\n');

export const buildSoldCaption = (
  l: RemovedAvByListing,
  feedLabel: string,
  index: number,
  total: number,
): string => {
  const block = formatListingBlock(l);
  const extra: string[] = [];
  if (l.firstSeenAt && l.removedAt) {
    const days = Math.max(
      1,
      Math.round((Date.parse(l.removedAt) - Date.parse(l.firstSeenAt)) / (1000 * 60 * 60 * 24)),
    );
    extra.push(`⏱ В продаже было ~${days} дн.`);
  }
  return [
    `<b>${NOTIFICATION_HEADERS.sold} · ${feedLabel} · ${index}/${total}</b>`,
    '',
    ...block,
    ...(extra.length ? ['', ...extra] : []),
  ].join('\n');
};

export const buildPriceChangeCaption = (
  change: AvByPriceChange,
  feedLabel: string,
  index: number,
  total: number,
): string => {
  const { listing: l, oldPriceUsd, oldPriceByn } = change;
  const arrow = l.priceUsd < oldPriceUsd ? '⬇️' : '⬆️';
  const diffUsd = l.priceUsd - oldPriceUsd;
  const diffByn = l.priceByn - oldPriceByn;
  const diffLine = [
    diffUsd ? `${diffUsd > 0 ? '+' : ''}${fmtUsd(diffUsd)}` : undefined,
    diffByn ? `${diffByn > 0 ? '+' : ''}${fmtByn(diffByn)}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  return [
    `<b>${NOTIFICATION_HEADERS.priceChanges} · ${feedLabel} · ${index}/${total}</b>`,
    '',
    ...formatListingBlock(l),
    '',
    `${arrow} Было: ${fmtUsd(oldPriceUsd)} · ${fmtByn(oldPriceByn)}`,
    diffLine ? `Δ ${diffLine}` : '',
  ]
    .filter(Boolean)
    .join('\n');
};

export const summarizeFeedForLog = (f: AvByFeedResult): string =>
  `${f.label}: total=${f.total}, new=${f.newListings.length}, sold=${f.soldListings.length}, priceΔ=${f.priceChanges.length}${f.isBaseline ? ' [BASELINE]' : ''}`;
