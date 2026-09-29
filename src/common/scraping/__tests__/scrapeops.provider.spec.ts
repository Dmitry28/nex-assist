import type { ConfigService } from '@nestjs/config';
import { ScrapeOpsProvider } from '../scrapeops.provider';
import { ScrapingQuotaError } from '../scraping.types';

const providerWithKey = (key: string | undefined): ScrapeOpsProvider => {
  const config = { get: () => key } as unknown as ConfigService;
  return new ScrapeOpsProvider(config);
};

/** Answers one request, capturing the URL that was called. */
const respond = (status: number, body = '<html>page</html>'): { seen: () => string } => {
  let seen = '';
  global.fetch = jest.fn((url: string) => {
    seen = url;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(body),
    });
  }) as unknown as typeof fetch;
  return { seen: () => seen };
};

describe('ScrapeOpsProvider', () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env.SCRAPEOPS_API_KEY;

  beforeEach(() => {
    delete process.env.SCRAPEOPS_API_KEY;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalEnv === undefined) delete process.env.SCRAPEOPS_API_KEY;
    else process.env.SCRAPEOPS_API_KEY = originalEnv;
  });

  it('reports itself unconfigured without a key, so the chain skips it', () => {
    expect(providerWithKey(undefined).isConfigured()).toBe(false);
    expect(providerWithKey('k').isConfigured()).toBe(true);
  });

  it('maps our options onto ScrapeOps parameter names', async () => {
    const { seen } = respond(200);
    await providerWithKey('k').scrape('https://bamper.by/x', { asp: true, country: 'BY' });

    const params = new URL(seen()).searchParams;
    expect(params.get('api_key')).toBe('k');
    expect(params.get('url')).toBe('https://bamper.by/x');
    expect(params.get('residential')).toBe('true');
    expect(params.get('country')).toBe('by');
    // Rendering is billed on top of residential, so an anti-bot call must not imply it.
    expect(params.get('render_js')).toBeNull();
  });

  it('passes the settle time as wait', async () => {
    const { seen } = respond(200);
    await providerWithKey('k').scrape('https://x', { renderWaitMs: 10_000 });
    expect(new URL(seen()).searchParams.get('wait')).toBe('10000');
  });

  it.each([401, 403])('treats HTTP %i as quota, so the chain stops asking', async status => {
    respond(status);
    await expect(providerWithKey('k').scrape('https://x', {})).rejects.toThrow(ScrapingQuotaError);
  });

  it('treats a failed target as a plain error, not quota', async () => {
    respond(500);
    const err = await providerWithKey('k')
      .scrape('https://x', {})
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ScrapingQuotaError);
  });

  it('rejects an empty body instead of reporting success', async () => {
    respond(200, '   ');
    await expect(providerWithKey('k').scrape('https://x', {})).rejects.toThrow('empty body');
  });
});
