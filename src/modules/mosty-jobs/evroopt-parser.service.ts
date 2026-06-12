import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// rebrowser-puppeteer: the e-rabota.by API sits behind a JS verification page
// that checks navigator.webdriver and sets an hg-security cookie before
// reloading — plain fetch gets "Access denied", a patched browser passes.
import puppeteer from 'rebrowser-puppeteer';
import type { Browser } from 'rebrowser-puppeteer';
import { BROWSER_USER_AGENT } from '../../common/utils/scraping';
import { sleep } from '../../common/utils/sleep';
import { EVROOPT_CITY_IDS, EVROOPT_PAGE_TIMEOUT_MS } from './constants';
import type { JobVacancy } from './dto/job-vacancy.dto';

const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-blink-features=AutomationControlled',
];

/** How long to keep polling the page body for JSON after navigation (ms). */
const JSON_POLL_TIMEOUT_MS = 15_000;
const JSON_POLL_INTERVAL_MS = 1_000;

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

const mapVacancy = (raw: unknown): JobVacancy | undefined => {
  if (!isRecord(raw)) return undefined;
  const id = typeof raw.id === 'number' ? raw.id : undefined;
  const title = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (id === undefined || !title) return undefined;

  const address = raw.address;
  return {
    // No per-vacancy public URL is reconstructable from the API (the site uses
    // opaque composite hashes) — link to the catalog; the id keeps the key unique.
    url: `https://e-rabota.by/vacancies#evroopt-${id}`,
    source: 'evroopt',
    title,
    employer: 'Евроопт',
    salary: formatSalary(raw.salary_from, raw.salary_to),
    address: isRecord(address) && typeof address.name === 'string' ? address.name : undefined,
  };
};

@Injectable()
export class EvrooptParserService {
  private readonly logger = new Logger(EvrooptParserService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Fetch Evroopt vacancies for the Мосты city ids via the e-rabota.by API.
   * Returns null when the source failed entirely (all city requests failed).
   */
  async fetch(): Promise<JobVacancy[] | null> {
    const apiUrl = this.config.getOrThrow<string>('mostyJobs.evrooptApiUrl');

    let browser: Browser | null = null;
    try {
      browser = await puppeteer.launch({ headless: true, args: BROWSER_ARGS });
      const byUrl = new Map<string, JobVacancy>();
      let anyCityOk = false;

      for (const cityId of EVROOPT_CITY_IDS) {
        const url = new URL(apiUrl);
        url.searchParams.set('skillazCity', String(cityId));
        const vacancies = await this.fetchCity(browser, url.toString());
        if (vacancies === null) {
          this.logger.warn(`e-rabota.by: city ${cityId} fetch failed`);
          continue;
        }
        anyCityOk = true;
        for (const v of vacancies) byUrl.set(v.url, v);
      }

      if (!anyCityOk) return null;
      this.logger.log(`e-rabota.by: ${byUrl.size} Evroopt vacancies fetched`);
      return [...byUrl.values()];
    } catch (err) {
      this.logger.error('e-rabota.by: browser session failed', err);
      return null;
    } finally {
      await browser?.close();
    }
  }

  /** Navigate to one city's API URL, wait out the JS challenge, parse the JSON body. */
  private async fetchCity(browser: Browser, url: string): Promise<JobVacancy[] | null> {
    const page = await browser.newPage();
    try {
      await page.setUserAgent(BROWSER_USER_AGENT);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: EVROOPT_PAGE_TIMEOUT_MS });

      // The challenge page sets a cookie and self-reloads after ~200ms — poll
      // the body until it becomes the API JSON.
      const deadline = Date.now() + JSON_POLL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const body = await page.evaluate(() => document.body.innerText);
        const vacancies = parseEvrooptJson(body);
        if (vacancies !== null) return vacancies;
        await sleep(JSON_POLL_INTERVAL_MS);
      }
      this.logger.warn(`e-rabota.by: JS challenge not resolved for ${url}`);
      return null;
    } catch (err) {
      this.logger.error(`e-rabota.by: failed to fetch ${url}`, err);
      return null;
    } finally {
      await page.close();
    }
  }
}

// ─── Pure parsing helpers ─────────────────────────────────────────────────────

/**
 * Parse the e-rabota.by vacancies API response. Returns null when the payload
 * is not the expected JSON (challenge page still showing). Exported for unit tests.
 */
export const parseEvrooptJson = (body: string): JobVacancy[] | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.data)) return null;

  return parsed.data.flatMap(raw => {
    const vacancy = mapVacancy(raw);
    return vacancy ? [vacancy] : [];
  });
};
