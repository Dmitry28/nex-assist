import type { ConfigService } from '@nestjs/config';
import { ScrapingAntProvider } from '../scrapingant.provider';
import { ScrapingQuotaError } from '../scraping.types';

const providerWithKey = (key: string | undefined): ScrapingAntProvider => {
  const config = { get: () => key } as unknown as ConfigService;
  return new ScrapingAntProvider(config);
};

describe('ScrapingAntProvider', () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env.SCRAPINGANT_API_KEY;

  beforeEach(() => {
    delete process.env.SCRAPINGANT_API_KEY;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalEnv === undefined) delete process.env.SCRAPINGANT_API_KEY;
    else process.env.SCRAPINGANT_API_KEY = originalEnv;
  });

  it('reports itself unconfigured without a key, so the chain skips it', () => {
    expect(providerWithKey(undefined).isConfigured()).toBe(false);
    expect(providerWithKey('k').isConfigured()).toBe(true);
  });

  it('sends the key as a header, not a query parameter', async () => {
    let init: RequestInit | undefined;
    let seenUrl = '';
    global.fetch = jest.fn((url: string, i: RequestInit) => {
      seenUrl = url;
      init = i;
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('<html/>') });
    }) as unknown as typeof fetch;

    await providerWithKey('secret').scrape('https://bamper.by/x', {});

    expect((init?.headers as Record<string, string>)['x-api-key']).toBe('secret');
    expect(seenUrl).not.toContain('secret');
  });

  it('maps our options onto ScrapingAnt parameter names', async () => {
    let seenUrl = '';
    global.fetch = jest.fn((url: string) => {
      seenUrl = url;
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('<html/>') });
    }) as unknown as typeof fetch;

    await providerWithKey('k').scrape('https://x', { renderJs: true, asp: true, country: 'by' });

    const params = new URL(seenUrl).searchParams;
    // JS rendering is `browser`; there is no separate anti-bot switch, so `asp` becomes a
    // residential proxy, which is where the bypass comes from.
    expect(params.get('browser')).toBe('true');
    expect(params.get('proxy_type')).toBe('residential');
    // Unsupported country is dropped: ScrapingAnt 422s on anything outside its enum, and
    // Belarus is not in it. This test previously asserted 'BY', which encoded the bug.
    expect(params.get('proxy_country')).toBeNull();
  });

  it('passes a supported country through, lower-cased', async () => {
    let seenUrl = '';
    global.fetch = jest.fn((url: string) => {
      seenUrl = url;
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('<html/>') });
    }) as unknown as typeof fetch;

    await providerWithKey('k').scrape('https://x', { country: 'PL' });
    expect(new URL(seenUrl).searchParams.get('proxy_country')).toBe('pl');
  });

  it('treats HTTP 429 as quota so a spent allowance is reported as such', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false, status: 429 }),
    ) as unknown as typeof fetch;
    await expect(providerWithKey('k').scrape('https://x', {})).rejects.toThrow(ScrapingQuotaError);
  });

  // Measured against bamper.by: 423 means "our browser was detected by target site". Calling
  // that a quota error would wrongly suggest the free tier had run out.
  it('treats HTTP 423 as a detection failure, not a spent quota', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false, status: 423 }),
    ) as unknown as typeof fetch;
    const call = providerWithKey('k').scrape('https://x', {});
    await expect(call).rejects.toThrow('detected by the target site');
    await expect(call).rejects.not.toBeInstanceOf(ScrapingQuotaError);
  });

  it('raises a plain error on other HTTP failures', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false, status: 500 }),
    ) as unknown as typeof fetch;
    await expect(providerWithKey('k').scrape('https://x', {})).rejects.toThrow(
      'ScrapingAnt returned HTTP 500',
    );
  });

  it('rejects an empty body instead of reporting success', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('  ') }),
    ) as unknown as typeof fetch;
    await expect(providerWithKey('k').scrape('https://x', {})).rejects.toThrow('empty body');
  });

  it('fails clearly when asked to scrape without a key', async () => {
    await expect(providerWithKey(undefined).scrape('https://x', {})).rejects.toThrow(
      'SCRAPINGANT_API_KEY is not configured',
    );
  });
});
