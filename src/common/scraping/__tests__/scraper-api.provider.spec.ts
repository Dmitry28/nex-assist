import type { ConfigService } from '@nestjs/config';
import { ScraperApiProvider } from '../scraper-api.provider';
import { ScrapingCapabilityError, ScrapingQuotaError } from '../scraping.types';

const providerWithKey = (key: string | undefined): ScraperApiProvider => {
  const config = { get: () => key } as unknown as ConfigService;
  return new ScraperApiProvider(config);
};

describe('ScraperApiProvider', () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env.SCRAPER_API_KEY;

  beforeEach(() => {
    delete process.env.SCRAPER_API_KEY;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalEnv === undefined) delete process.env.SCRAPER_API_KEY;
    else process.env.SCRAPER_API_KEY = originalEnv;
  });

  describe('isConfigured', () => {
    it('is false without a key, so the chain skips it', () => {
      expect(providerWithKey(undefined).isConfigured()).toBe(false);
    });

    it('is true with a key', () => {
      expect(providerWithKey('k').isConfigured()).toBe(true);
    });
  });

  it('maps our options onto ScraperAPI parameter names', async () => {
    let called = '';
    global.fetch = jest.fn((url: string) => {
      called = url;
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve('<html>ok</html>'),
      } as unknown as Response);
    }) as unknown as typeof fetch;

    await providerWithKey('secret').scrape('https://bamper.by/x', {
      country: 'BY',
      asp: true,
      renderJs: true,
      renderWaitMs: 8000,
    });

    const params = new URL(called).searchParams;
    expect(params.get('api_key')).toBe('secret');
    expect(params.get('url')).toBe('https://bamper.by/x');
    // ScraperAPI's anti-bot tier and render flag are named differently from ScrapFly's.
    expect(params.get('ultra_premium')).toBe('true');
    expect(params.get('render')).toBe('true');
    // Country must be lower-case for ScraperAPI.
    expect(params.get('country_code')).toBe('by');
    // A millisecond settle time has no direct equivalent; it becomes a seconds-based timeout.
    expect(params.get('render_timeout')).toBe('8');
  });

  it('returns the body directly — there is no JSON envelope', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('<html>page</html>') }),
    ) as unknown as typeof fetch;

    const result = await providerWithKey('k').scrape('https://x', {});
    expect(result).toEqual({ content: '<html>page</html>', provider: 'scraperapi' });
  });

  it('raises a quota error on HTTP 429 so a spent allowance is reported as such', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false, status: 429 }),
    ) as unknown as typeof fetch;
    await expect(providerWithKey('k').scrape('https://x', {})).rejects.toThrow(ScrapingQuotaError);
  });

  // Measured against bamper.by: 403 is "this country needs the premium residential tier".
  // Reporting it as quota would wrongly suggest the free tier had run out.
  it('treats HTTP 403 as a plan rejection, not a spent quota', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false, status: 403 }),
    ) as unknown as typeof fetch;
    const call = providerWithKey('k').scrape('https://x', {});
    await expect(call).rejects.toThrow('rejected the request for this plan');
    await expect(call).rejects.not.toBeInstanceOf(ScrapingQuotaError);
    // Typed so the chain can remember the refusal instead of re-queueing it every call.
    await expect(call).rejects.toBeInstanceOf(ScrapingCapabilityError);
  });

  it('raises a plain error on other HTTP failures', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false, status: 500 }),
    ) as unknown as typeof fetch;
    const call = providerWithKey('k').scrape('https://x', {});
    await expect(call).rejects.toThrow('ScraperAPI returned HTTP 500');
    await expect(call).rejects.not.toBeInstanceOf(ScrapingQuotaError);
  });

  it('rejects an empty body rather than reporting a successful scrape', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('   ') }),
    ) as unknown as typeof fetch;
    await expect(providerWithKey('k').scrape('https://x', {})).rejects.toThrow('empty body');
  });

  it('fails clearly when asked to scrape without a key', async () => {
    await expect(providerWithKey(undefined).scrape('https://x', {})).rejects.toThrow(
      'SCRAPER_API_KEY is not configured',
    );
  });
});
