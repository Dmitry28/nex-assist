import type { ConfigService } from '@nestjs/config';
import { ScrapeDoProvider } from '../scrape-do.provider';
import { ScrapingQuotaError } from '../scraping.types';

const providerWithKey = (key: string | undefined): ScrapeDoProvider => {
  const config = { get: () => key } as unknown as ConfigService;
  return new ScrapeDoProvider(config);
};

/** Answers one request, capturing the URL that was called. */
const respond = (init: {
  ok: boolean;
  status: number;
  body?: string;
  headers?: Record<string, string>;
}): { seen: () => string } => {
  let seen = '';
  global.fetch = jest.fn((url: string) => {
    seen = url;
    return Promise.resolve({
      ok: init.ok,
      status: init.status,
      headers: { get: (name: string): string | null => init.headers?.[name] ?? null },
      text: () => Promise.resolve(init.body ?? '<html/>'),
    });
  }) as unknown as typeof fetch;
  return { seen: () => seen };
};

const ok = (headers?: Record<string, string>): { seen: () => string } =>
  respond({ ok: true, status: 200, body: '<html>page</html>', headers });

describe('ScrapeDoProvider', () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env.SCRAPE_DO_API_KEY;

  beforeEach(() => {
    delete process.env.SCRAPE_DO_API_KEY;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalEnv === undefined) delete process.env.SCRAPE_DO_API_KEY;
    else process.env.SCRAPE_DO_API_KEY = originalEnv;
  });

  it('reports itself unconfigured without a key, so the chain skips it', () => {
    expect(providerWithKey(undefined).isConfigured()).toBe(false);
    expect(providerWithKey('k').isConfigured()).toBe(true);
  });

  it('maps our options onto Scrape.do parameter names', async () => {
    const call = ok();
    await providerWithKey('secret').scrape('https://bamper.by/x', {
      asp: true,
      renderJs: true,
      country: 'BY',
      renderWaitMs: 10_000,
    });

    const p = new URL(call.seen()).searchParams;
    expect(p.get('token')).toBe('secret');
    expect(p.get('url')).toBe('https://bamper.by/x');
    // `super` is the residential tier — the only thing that clears Cloudflare on bamper.by.
    expect(p.get('super')).toBe('true');
    expect(p.get('render')).toBe('true');
    // Lower-case ISO-2. Belarus is on the residential list, which is the whole point of adding
    // this provider — ScraperAPI's free tier answers 403 to the same request.
    expect(p.get('geoCode')).toBe('by');
    expect(p.get('customWait')).toBe('10000');
  });

  // Residential is a 10x multiplier and rendering another 5x on top; charging both for a caller
  // that asked for neither is how a monthly tier disappears in a week.
  it('does not render for an anti-bot call that did not ask for it', async () => {
    const call = ok();
    await providerWithKey('k').scrape('https://x', { asp: true, country: 'by' });

    const p = new URL(call.seen()).searchParams;
    expect(p.get('super')).toBe('true');
    expect(p.get('render')).toBeNull();
  });

  it('turns on rendering when a settle time is requested', async () => {
    const call = ok();
    await providerWithKey('k').scrape('https://x', { renderWaitMs: 8_000 });

    expect(new URL(call.seen()).searchParams.get('render')).toBe('true');
  });

  it('omits the optional parameters when not asked for', async () => {
    const call = ok();
    await providerWithKey('k').scrape('https://x', {});

    const p = new URL(call.seen()).searchParams;
    expect(p.get('super')).toBeNull();
    expect(p.get('render')).toBeNull();
    expect(p.get('geoCode')).toBeNull();
  });

  // Scrape.do enables super/render by itself for domains that need them, so the header is the
  // only honest account of what a call cost.
  it('reports the cost the provider billed, not the one we assumed', async () => {
    ok({ 'scrape.do-request-cost': '10', 'scrape.do-remaining-credits': '955' });

    expect(await providerWithKey('k').scrape('https://x', { asp: true })).toEqual({
      content: '<html>page</html>',
      provider: 'scrapedo',
      cost: 10,
    });
  });

  it('omits the cost when the provider did not report one', async () => {
    ok();
    expect(await providerWithKey('k').scrape('https://x', {})).toEqual({
      content: '<html>page</html>',
      provider: 'scrapedo',
    });
  });

  it.each([
    [429, 'monthly credits exhausted'],
    [401, 'rejected the token'],
  ])('treats HTTP %i as quota so the chain moves on', async (status, message) => {
    respond({ ok: false, status });
    const call = providerWithKey('k').scrape('https://x', {});
    await expect(call).rejects.toThrow(ScrapingQuotaError);
    await expect(call).rejects.toThrow(message);
  });

  // Measured: bamper.by answers 502 through a datacenter IP and 200 through a residential one.
  // That is a failed bypass, not a spent tier, and the log has to say so.
  it('treats a refused bypass as a plain error, not quota', async () => {
    respond({ ok: false, status: 502 });
    const call = providerWithKey('k').scrape('https://x', {});
    await expect(call).rejects.toThrow('Scrape.do returned HTTP 502');
    await expect(call).rejects.not.toBeInstanceOf(ScrapingQuotaError);
  });

  it('rejects an empty body instead of reporting success', async () => {
    respond({ ok: true, status: 200, body: '   ' });
    await expect(providerWithKey('k').scrape('https://x', {})).rejects.toThrow('empty body');
  });

  it('fails clearly when asked to scrape without a key', async () => {
    await expect(providerWithKey(undefined).scrape('https://x', {})).rejects.toThrow(
      'SCRAPE_DO_API_KEY is not configured',
    );
  });
});
