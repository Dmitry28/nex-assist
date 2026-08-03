import type { ConfigService } from '@nestjs/config';
import { ScrapingQuotaError } from '../scraping.types';
import { ZenRowsProvider } from '../zenrows.provider';

const providerWithKey = (key: string | undefined): ZenRowsProvider => {
  const config = { get: () => key } as unknown as ConfigService;
  return new ZenRowsProvider(config);
};

const respond = (init: { ok: boolean; status: number; body?: string }): void => {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ...init, text: () => Promise.resolve(init.body ?? '') }),
  ) as unknown as typeof fetch;
};

describe('ZenRowsProvider', () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env.ZENROWS_API_KEY;

  beforeEach(() => {
    delete process.env.ZENROWS_API_KEY;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalEnv === undefined) delete process.env.ZENROWS_API_KEY;
    else process.env.ZENROWS_API_KEY = originalEnv;
  });

  it('reports itself unconfigured without a key, so the chain skips it', () => {
    expect(providerWithKey(undefined).isConfigured()).toBe(false);
    expect(providerWithKey('k').isConfigured()).toBe(true);
  });

  it('maps our options onto ZenRows parameter names', async () => {
    let seen = '';
    global.fetch = jest.fn((url: string) => {
      seen = url;
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('<html/>') });
    }) as unknown as typeof fetch;

    await providerWithKey('secret').scrape('https://bamper.by/x', {
      asp: true,
      renderJs: true,
      country: 'BY',
    });

    const p = new URL(seen).searchParams;
    expect(p.get('apikey')).toBe('secret');
    expect(p.get('url')).toBe('https://bamper.by/x');
    // `premium_proxy` is the anti-bot tier that clears Cloudflare.
    expect(p.get('premium_proxy')).toBe('true');
    expect(p.get('js_render')).toBe('true');
    // Lower-case ISO-2 — the mistake that broke ScrapingAnt for every country.
    expect(p.get('proxy_country')).toBe('by');
  });

  it('omits the optional parameters when not asked for', async () => {
    let seen = '';
    global.fetch = jest.fn((url: string) => {
      seen = url;
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('<html/>') });
    }) as unknown as typeof fetch;

    await providerWithKey('k').scrape('https://x', {});
    const p = new URL(seen).searchParams;
    expect(p.get('premium_proxy')).toBeNull();
    expect(p.get('js_render')).toBeNull();
    expect(p.get('proxy_country')).toBeNull();
  });

  it.each([402, 429])('treats HTTP %i as quota so the chain moves on', async status => {
    respond({ ok: false, status });
    await expect(providerWithKey('k').scrape('https://x', {})).rejects.toThrow(ScrapingQuotaError);
  });

  // A block by the target must stay distinguishable from a spent allowance — the mistake made
  // on both earlier providers.
  it('treats other failures as plain errors, not quota', async () => {
    respond({ ok: false, status: 403 });
    const call = providerWithKey('k').scrape('https://x', {});
    await expect(call).rejects.toThrow('ZenRows returned HTTP 403');
    await expect(call).rejects.not.toBeInstanceOf(ScrapingQuotaError);
  });

  it('rejects an empty body instead of reporting success', async () => {
    respond({ ok: true, status: 200, body: '   ' });
    await expect(providerWithKey('k').scrape('https://x', {})).rejects.toThrow('empty body');
  });

  it('returns the body directly, with the provider name', async () => {
    respond({ ok: true, status: 200, body: '<html>page</html>' });
    expect(await providerWithKey('k').scrape('https://x', {})).toEqual({
      content: '<html>page</html>',
      provider: 'zenrows',
    });
  });

  it('fails clearly when asked to scrape without a key', async () => {
    await expect(providerWithKey(undefined).scrape('https://x', {})).rejects.toThrow(
      'ZENROWS_API_KEY is not configured',
    );
  });
});
