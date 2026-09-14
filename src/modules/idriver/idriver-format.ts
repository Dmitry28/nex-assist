import { LOCALE, TIMEZONE } from '../../common/utils/locale';
import type { IdriverFeedResult, IdriverListing, IdriverResult } from './dto/idriver-listing.dto';

const PRICE_ON_REQUEST = 'Цена по запросу';

/** Max seller-note length shown in a caption — keeps within Telegram's 1024-char limit. */
const DESCRIPTION_LIMIT = 220;

export const formatPrice = (listing: IdriverListing): string =>
  listing.priceByn && listing.priceByn > 0
    ? `${listing.priceByn.toLocaleString(LOCALE)} р.`
    : PRICE_ON_REQUEST;

export interface ListingCaptionParams {
  listing: IdriverListing;
  car: string;
  index: number;
  total: number;
}

export const buildListingCaption = ({
  listing,
  car,
  index,
  total,
}: ListingCaptionParams): string => {
  // The part name leads the header: unlike bamper.by, one feed here covers every part of the
  // car, so the part is news rather than a constant.
  const lines: string[] = [
    `<b>🆕 ${car} · ${listing.part} · ${index}/${total}</b>`,
    '',
    `🚗 <b>${listing.title}</b>`,
    '',
    `💰 ${formatPrice(listing)}`,
  ];
  if (listing.year) lines.push(`📅 ${listing.year} г.`);
  if (listing.carSpec) lines.push(`⚙️ ${listing.carSpec}`);
  const place = [listing.city, listing.seller].filter(Boolean).join(' · ');
  if (place) lines.push(`📍 ${place}`);
  if (listing.description) {
    const text =
      listing.description.length > DESCRIPTION_LIMIT
        ? `${listing.description.slice(0, DESCRIPTION_LIMIT).trimEnd()}…`
        : listing.description;
    lines.push('', `📝 ${text}`);
  }
  lines.push('', `<a href="${listing.url}">🔗 Подробнее</a>`);
  return lines.join('\n');
};

/** One line per car for the run summary — the car links to the monitored catalogue. */
const feedSummaryLine = (feed: IdriverFeedResult, minYear: number): string => {
  const bits = [`на странице ${feed.total}`, `${minYear}+: ${feed.matching}`];
  if (feed.newListings.length > 0) bits.unshift(`🆕 ${feed.newListings.length} нов.`);
  return `• <a href="${feed.url}">${feed.car}</a>: ${bits.join(' · ')}`;
};

export const buildSummary = (result: IdriverResult, minYear: number): string => {
  const date = new Date().toLocaleDateString(LOCALE, { timeZone: TIMEZONE });
  const lines = [`<b>🔩 idriver.by · запчасти Atlas · ${date}</b>`, ''];
  for (const feed of result.feeds) lines.push(feedSummaryLine(feed, minYear));
  // A completely unseen page means the catalogue turned over faster than the run interval, so
  // arrivals may have scrolled off before we looked. Saying nothing would pass that off as a
  // clean run.
  const missed = result.feeds.filter(f => f.mayHaveMissed).map(f => f.car);
  if (missed.length > 0) {
    lines.push('', `⚠️ Страница обновилась целиком (${missed.join(', ')}) — часть могла уйти`);
  }
  if (result.failedFeeds.length > 0) {
    lines.push('', `⚠️ Не удалось проверить: ${result.failedFeeds.join(', ')}`);
  }
  return lines.join('\n');
};
