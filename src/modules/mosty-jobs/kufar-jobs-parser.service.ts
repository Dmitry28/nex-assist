import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JobVacancy } from './dto/job-vacancy.dto';
import { fetchText } from './mosty-jobs-http';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** kufar stores prices in kopecks as a string, e.g. "350000" = 3 500 BYN. */
const formatSalaryByn = (priceByn: unknown): string | undefined => {
  if (typeof priceByn !== 'string' || !/^\d+$/.test(priceByn)) return undefined;
  const rubles = Math.round(Number(priceByn) / 100);
  if (rubles <= 0) return undefined;
  return `${rubles} руб.`;
};

const getParam = (ad: Record<string, unknown>, name: string): string | undefined => {
  const params = ad.ad_parameters;
  if (!Array.isArray(params)) return undefined;
  for (const p of params) {
    if (isRecord(p) && p.p === name && typeof p.vl === 'string') return p.vl;
  }
  return undefined;
};

const mapAd = (raw: unknown): JobVacancy | undefined => {
  if (!isRecord(raw)) return undefined;
  const adId = typeof raw.ad_id === 'number' ? raw.ad_id : undefined;
  const title = typeof raw.subject === 'string' ? raw.subject.trim() : '';
  if (adId === undefined || !title) return undefined;

  return {
    url: `https://www.kufar.by/item/${adId}`,
    source: 'kufar',
    title,
    salary: formatSalaryByn(raw.price_byn),
    address: getParam(raw, 'area') ?? getParam(raw, 'region'),
  };
};

@Injectable()
export class KufarJobsParserService {
  private readonly logger = new Logger(KufarJobsParserService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Fetch kufar.by job ads for Мосты via the public search API.
   * Usually returns an empty list — private job ads in Mosty are rare; the
   * point is to catch them when they appear. Returns null on source failure.
   */
  async fetch(): Promise<JobVacancy[] | null> {
    const url = this.config.getOrThrow<string>('mostyJobs.kufarSearchUrl');
    const body = await fetchText(url, this.logger);
    if (body === null) return null;

    const vacancies = parseKufarJobsJson(body);
    if (vacancies === null) {
      this.logger.warn('kufar.by: response is not the expected search JSON');
      return null;
    }
    this.logger.log(`kufar.by: ${vacancies.length} job ads fetched`);
    return vacancies;
  }
}

// ─── Pure parsing helpers ─────────────────────────────────────────────────────

/**
 * Parse the kufar search API response. Returns null when the payload doesn't
 * look like the search JSON (treat as source failure). Exported for unit tests.
 */
export const parseKufarJobsJson = (body: string): JobVacancy[] | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.ads)) return null;

  return parsed.ads.flatMap(raw => {
    const vacancy = mapAd(raw);
    return vacancy ? [vacancy] : [];
  });
};
