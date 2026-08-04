import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EscalatingHtmlFetcher } from '../../common/scraping/escalating-html-fetcher';
import { decodeHtmlEntities } from '../../common/utils/html-entities';
import { EVROOPT_CITY_IDS, EVROOPT_PAGE_TIMEOUT_MS, MAX_HTML_SIZE_BYTES } from './constants';
import type { JobVacancy } from './dto/job-vacancy.dto';

/** Public site the API's relative vacancy paths belong to. */
const SITE_ORIGIN = 'https://e-rabota.by';

/**
 * Proxy country for the paid rung. e-rabota.by answers 403 "ЗАПРОС ЗАБЛОКИРОВАН" to any
 * non-Belarusian address, so a Belarus exit is the whole reason this source needs a provider —
 * see the class comment.
 */
const PROXY_COUNTRY = 'by';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const formatSalary = (from: unknown, to: unknown): string | undefined => {
  const lo = typeof from === 'number' && from > 0 ? from : undefined;
  const hi = typeof to === 'number' && to > 0 ? to : undefined;
  if (lo === undefined && hi === undefined) return undefined;
  if (lo !== undefined && hi !== undefined) {
    return lo === hi ? `${lo} руб.` : `${lo} – ${hi} руб.`;
  }
  return lo !== undefined ? `от ${lo} руб.` : `до ${hi} руб.`;
};

/**
 * Public link for one vacancy. The API returns a path under an opaque hash — verified live:
 * `https://e-rabota.by/63c6a87e…` renders "Грузчик, Мосты". An earlier comment here claimed no
 * per-vacancy URL was reconstructable and linked everything to the catalog instead; the `url`
 * field had simply gone unread. The catalog anchor stays as the fallback so a missing field
 * degrades to a usable message rather than dropping the vacancy.
 */
const vacancyUrl = (raw: Record<string, unknown>, id: number): string =>
  typeof raw.url === 'string' && raw.url.startsWith('/')
    ? `${SITE_ORIGIN}${raw.url}`
    : `${SITE_ORIGIN}/vacancies#evroopt-${id}`;

const mapVacancy = (raw: unknown): JobVacancy | undefined => {
  if (!isRecord(raw)) return undefined;
  const id = typeof raw.id === 'number' ? raw.id : undefined;
  const title = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (id === undefined || !title) return undefined;

  const address = raw.address;
  return {
    url: vacancyUrl(raw, id),
    source: 'evroopt',
    title,
    employer: 'Евроопт',
    salary: formatSalary(raw.salary_from, raw.salary_to),
    address: isRecord(address) && typeof address.name === 'string' ? address.name : undefined,
  };
};

/**
 * Evroopt vacancies via the e-rabota.by JSON API.
 *
 * This source spent months reporting "JS challenge not resolved", and that diagnosis was wrong.
 * Measured with a real browser: the challenge *is* solved — `navigator.webdriver` reads false and
 * the hg-security cookie gets set — and the site then answers 403 "ЗАПРОС ЗАБЛОКИРОВАН" naming
 * the caller's IP. The block is geographic, not a bot check, so no amount of browser patching
 * helps and the private Puppeteer session this service used to own was pure cost.
 *
 * It now rides the shared ladder like every other source: a plain request and a local browser are
 * still tried first (both work from inside Belarus), and only then a provider with a Belarus exit,
 * which is where CI gets its data. Replaying the challenge cookie over plain HTTP was tried and
 * is refused with 403 even when fresh, so there is no cheaper path than a Belarusian address.
 */
@Injectable()
export class EvrooptParserService {
  private readonly logger = new Logger(EvrooptParserService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly html: EscalatingHtmlFetcher,
  ) {}

  /**
   * Fetch Evroopt vacancies for the Мосты city ids.
   * Returns null when the source failed entirely (every city request failed).
   */
  async fetch(): Promise<JobVacancy[] | null> {
    const apiUrl = this.config.getOrThrow<string>('mostyJobs.evrooptApiUrl');
    const byUrl = new Map<string, JobVacancy>();
    let anyCityOk = false;

    for (const cityId of EVROOPT_CITY_IDS) {
      const url = new URL(apiUrl);
      url.searchParams.set('skillazCity', String(cityId));

      const body = await this.html.fetch(url.toString(), {
        label: `e-rabota.by city ${cityId}`,
        // The parser is its own usability test: a body counts only if it yields the expected
        // shape. A substring check would pass on the 403 page and stop the ladder early, which
        // is how rabota.by silently went down.
        isUsable: candidate => parseEvrooptJson(candidate) !== null,
        timeoutMs: EVROOPT_PAGE_TIMEOUT_MS,
        maxBytes: MAX_HTML_SIZE_BYTES,
        country: PROXY_COUNTRY,
      });

      if (body === null) {
        this.logger.warn(`e-rabota.by: city ${cityId} fetch failed`);
        continue;
      }
      anyCityOk = true;
      // Parsed twice — once to accept the body, once to use it. These payloads are single-digit
      // kilobytes, so the duplicate parse costs less than threading the result out of the ladder.
      for (const vacancy of parseEvrooptJson(body) ?? []) byUrl.set(vacancy.url, vacancy);
    }

    if (!anyCityOk) return null;
    this.logger.log(`e-rabota.by: ${byUrl.size} Evroopt vacancies fetched`);
    return [...byUrl.values()];
  }
}

// ─── Pure parsing helpers ─────────────────────────────────────────────────────

/** A JSON response read through a browser arrives inside the `<pre>` Chrome renders it into. */
const PRE_WRAPPED_RE = /<pre[^>]*>([\s\S]*?)<\/pre>/i;

/**
 * Parse the e-rabota.by vacancies API response. Returns null when the payload is not the
 * expected JSON — a 403 page, or a challenge still showing. Exported for unit tests.
 */
export const parseEvrooptJson = (body: string): JobVacancy[] | null => {
  const wrapped = PRE_WRAPPED_RE.exec(body);
  const payload = wrapped ? decodeHtmlEntities(wrapped[1]) : body;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.data)) return null;

  return parsed.data.flatMap(raw => {
    const vacancy = mapVacancy(raw);
    return vacancy ? [vacancy] : [];
  });
};
