import type { ConfigService } from '@nestjs/config';
import { ScrapingQuotaError } from '../scraping.types';
import { ZenRowsProvider } from '../zenrows.provider';

// The retry pause is real seconds in production and nothing to wait for in a test.
jest.mock('../../utils/sleep', () => ({ sleep: (): Promise<void> => Promise.resolve() }));

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

  // Rendering triples the price (10 credits → 25) and this provider used to force it onto every
  // asp call, on a measurement that premium_proxy alone returned 422. Re-measured: bamper.by
  // returns the same page with the same 8 listings either way. Charging the render bracket for
  // callers that never asked to render burned most of the monthly free tier for nothing.
  it('does not add js_render for an asp call that did not ask for rendering', async () => {
    let seen = '';
    global.fetch = jest.fn((url: string) => {
      seen = url;
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('<html/>') });
    }) as unknown as typeof fetch;

    await providerWithKey('k').scrape('https://x', { asp: true, country: 'by' });

    const p = new URL(seen).searchParams;
    expect(p.get('premium_proxy')).toBe('true');
    expect(p.get('js_render')).toBeNull();
  });

  // bid.cars asks for a settle time without naming renderJs, and `wait` is meaningless unless
  // something is rendering — so the request has to imply it or that feed silently returns 0 lots.
  it('turns on js_render when a settle time is requested', async () => {
    let seen = '';
    global.fetch = jest.fn((url: string) => {
      seen = url;
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('<html/>') });
    }) as unknown as typeof fetch;

    await providerWithKey('k').scrape('https://x', { asp: true, renderWaitMs: 10_000 });

    const p = new URL(seen).searchParams;
    expect(p.get('js_render')).toBe('true');
    expect(p.get('wait')).toBe('10000');
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

  it('treats HTTP 402 as quota so the chain moves on at once', async () => {
    respond({ ok: false, status: 402 });
    await expect(providerWithKey('k').scrape('https://x', {})).rejects.toThrow(ScrapingQuotaError);
  });

  // 422 is RESP001 "could not get content" — a bypass that failed on ZenRows' side, documented
  // as retryable. It cost three days of bamper.by runs before anything retried it.
  describe('a retryable failure', () => {
    const respondThen = (statuses: number[], body: string): jest.Mock => {
      const fn = jest.fn(() => {
        const status = statuses.shift() ?? 200;
        return Promise.resolve({
          ok: status === 200,
          status,
          text: () => Promise.resolve(body),
        });
      });
      global.fetch = fn as unknown as typeof fetch;
      return fn;
    };

    it('retries a 422 and returns the page when the next attempt succeeds', async () => {
      const fetchMock = respondThen([422], '<html>page</html>');
      const result = await providerWithKey('k').scrape('https://x', {});

      expect(result).toEqual({ content: '<html>page</html>', provider: 'zenrows' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('gives up after the retries and reports a plain failure, not a spent tier', async () => {
      const fetchMock = respondThen([422, 422, 422], '');
      const call = providerWithKey('k').scrape('https://x', {});

      await expect(call).rejects.toThrow('ZenRows returned HTTP 422 after 2 retries');
      await expect(call).rejects.not.toBeInstanceOf(ScrapingQuotaError);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    // The concurrency limit clears on its own, but a persistent one still means "nothing more
    // from this provider now" — the chain reads that as quota and skips it for the run.
    it('retries a 429 and reports quota once it persists', async () => {
      respondThen([429, 429, 429], '');
      await expect(providerWithKey('k').scrape('https://x', {})).rejects.toThrow(
        ScrapingQuotaError,
      );
    });
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

// Measured on bid.cars: without a settle time the body came back 254 KB with zero lot links;
// with `wait=10000` it was 764 KB with 53. A site that fills results after load is otherwise
// indistinguishable from an empty one.
describe('ZenRowsProvider — settle time', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('passes renderWaitMs through as `wait`', async () => {
    let seen = '';
    global.fetch = jest.fn((url: string) => {
      seen = url;
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('<html/>') });
    }) as unknown as typeof fetch;

    await providerWithKey('k').scrape('https://x', { asp: true, renderWaitMs: 10_000 });

    expect(new URL(seen).searchParams.get('wait')).toBe('10000');
  });
});
