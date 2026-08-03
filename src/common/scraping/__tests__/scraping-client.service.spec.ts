import { ScrapingClient } from '../scraping-client.service';
import {
  ScrapingQuotaError,
  type ScrapeOptions,
  type ScrapeResult,
  type ScrapingProvider,
} from '../scraping.types';

/** A stub provider whose behaviour each test dictates. */
const provider = (
  name: string,
  behaviour: 'ok' | 'quota' | 'error' | 'unconfigured',
): ScrapingProvider & { calls: number } => ({
  name,
  calls: 0,
  isConfigured() {
    return behaviour !== 'unconfigured';
  },
  scrape(_url: string, _opts: ScrapeOptions): Promise<ScrapeResult> {
    (this as { calls: number }).calls++;
    if (behaviour === 'quota') {
      return Promise.reject(new ScrapingQuotaError(name, `${name} out of quota`));
    }
    if (behaviour === 'error') return Promise.reject(new Error(`${name} broke`));
    return Promise.resolve({ content: `<html>${name}</html>`, provider: name });
  },
});

describe('ScrapingClient', () => {
  describe('isAvailable', () => {
    it('is false when no provider has credentials, so callers can skip the chain', () => {
      expect(new ScrapingClient([provider('a', 'unconfigured')]).isAvailable()).toBe(false);
    });

    it('is true when at least one has credentials', () => {
      const providers = [provider('a', 'unconfigured'), provider('b', 'ok')];
      expect(new ScrapingClient(providers).isAvailable()).toBe(true);
    });
  });

  it('uses the first configured provider and does not touch the rest', async () => {
    const first = provider('first', 'ok');
    const second = provider('second', 'ok');
    const result = await new ScrapingClient([first, second]).scrape('https://x');

    expect(result.provider).toBe('first');
    expect(second.calls).toBe(0);
  });

  // The point of the chain: exhausting one provider's free tier must not stop the scrape.
  it('falls through to the next provider when the first is out of quota', async () => {
    const exhausted = provider('exhausted', 'quota');
    const spare = provider('spare', 'ok');
    const result = await new ScrapingClient([exhausted, spare]).scrape('https://x');

    expect(result.provider).toBe('spare');
    expect(exhausted.calls).toBe(1);
    expect(spare.calls).toBe(1);
  });

  it('falls through on an ordinary failure too, not just on quota', async () => {
    const broken = provider('broken', 'error');
    const spare = provider('spare', 'ok');
    expect((await new ScrapingClient([broken, spare]).scrape('https://x')).provider).toBe('spare');
  });

  it('walks the whole chain — a third provider is reached when two are exhausted', async () => {
    const a = provider('a', 'quota');
    const b = provider('b', 'quota');
    const c = provider('c', 'ok');
    const result = await new ScrapingClient([a, b, c]).scrape('https://x');

    expect(result.provider).toBe('c');
    expect([a.calls, b.calls, c.calls]).toEqual([1, 1, 1]);
  });

  it('skips unconfigured providers rather than counting them as failures', async () => {
    const keyless = provider('keyless', 'unconfigured');
    const working = provider('working', 'ok');
    const result = await new ScrapingClient([keyless, working]).scrape('https://x');

    expect(result.provider).toBe('working');
    expect(keyless.calls).toBe(0);
  });

  it('throws when every provider is exhausted, surfacing the last failure', async () => {
    const client = new ScrapingClient([provider('a', 'quota'), provider('b', 'error')]);
    await expect(client.scrape('https://x')).rejects.toThrow('b broke');
  });

  it('throws a clear error when nothing is configured at all', async () => {
    const client = new ScrapingClient([provider('a', 'unconfigured')]);
    await expect(client.scrape('https://x')).rejects.toThrow('No scraping provider is configured');
  });

  it('passes the caller options through to the provider', async () => {
    const opts: ScrapeOptions = { country: 'by', asp: true, renderJs: true, renderWaitMs: 8000 };
    let seen: ScrapeOptions | undefined;
    const spy: ScrapingProvider = {
      name: 'spy',
      isConfigured: () => true,
      scrape: (_url, o) => {
        seen = o;
        return Promise.resolve({ content: '', provider: 'spy' });
      },
    };
    await new ScrapingClient([spy]).scrape('https://x', opts);
    expect(seen).toEqual(opts);
  });
});
