import { ScrapingClient } from '../scraping-client.service';
import {
  ScrapingCapabilityError,
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

  // Three days of bamper.by outages were reported as "ScrapFly out of quota" — the last link in
  // the chain, long spent — while the failure that mattered was a ZenRows 422 two links earlier.
  // A spent allowance is not a diagnosis, so it must not be what the caller sees.
  it('surfaces the provider that genuinely failed, not a later spent one', async () => {
    const client = new ScrapingClient([provider('real', 'error'), provider('spent', 'quota')]);
    await expect(client.scrape('https://x')).rejects.toThrow('real broke');
  });

  // ScrapFly's free credits are granted once at signup and never refill, so every later call in
  // the run is a guaranteed wasted round-trip.
  describe('a provider that reported a spent allowance', () => {
    it('stops calling it for the rest of the run', async () => {
      const spent = provider('spent', 'quota');
      const spare = provider('spare', 'ok');
      const client = new ScrapingClient([spent, spare]);

      expect((await client.scrape('https://a')).provider).toBe('spare');
      expect((await client.scrape('https://b')).provider).toBe('spare');
      expect(spent.calls).toBe(1);
    });

    // Same rule as the plan-refusal memo: it may never be the reason nothing gets tried.
    it('ignores the memo when it would leave no provider to try', async () => {
      const spent = provider('only', 'quota');
      const client = new ScrapingClient([spent]);

      await expect(client.scrape('https://a')).rejects.toThrow('only out of quota');
      await expect(client.scrape('https://b')).rejects.toThrow('only out of quota');
      expect(spent.calls).toBe(2);
    });
  });

  it('throws a clear error when nothing is configured at all', async () => {
    const client = new ScrapingClient([provider('a', 'unconfigured')]);
    await expect(client.scrape('https://x')).rejects.toThrow('No scraping provider is configured');
  });

  // ScraperAPI's free tier refuses every anti-bot request with a 403. The chain used to re-queue
  // that refusal on every feed of every run, ~20s each, and log it as a failure worth reading.
  describe('a plan that refuses anti-bot requests', () => {
    const refusing = (name: string): ScrapingProvider & { calls: number } => ({
      name,
      calls: 0,
      isConfigured: () => true,
      scrape(_url: string, _opts: ScrapeOptions): Promise<ScrapeResult> {
        (this as { calls: number }).calls++;
        return Promise.reject(new ScrapingCapabilityError(name, `${name} cannot do that`));
      },
    });

    it('stops asking it after the first refusal', async () => {
      const refuser = refusing('refuser');
      const spare = provider('spare', 'ok');
      const client = new ScrapingClient([refuser, spare]);

      expect((await client.scrape('https://a', { asp: true })).provider).toBe('spare');
      expect((await client.scrape('https://b', { asp: true })).provider).toBe('spare');
      expect(refuser.calls).toBe(1);
    });

    // The refusal is about the anti-bot tier, so ordinary requests must keep using the provider.
    it('keeps using it for requests that are not anti-bot', async () => {
      const refuser = refusing('refuser');
      const client = new ScrapingClient([refuser, provider('spare', 'ok')]);

      await client.scrape('https://a', { asp: true });
      await client.scrape('https://b');
      expect(refuser.calls).toBe(2);
    });

    // A memo must never be able to empty the chain: with nothing left it is ignored and the
    // refusing provider is tried again, so a real error surfaces instead of "no providers".
    it('ignores the memo when it would leave no provider to try', async () => {
      const refuser = refusing('only');
      const client = new ScrapingClient([refuser]);

      await expect(client.scrape('https://a', { asp: true })).rejects.toThrow(
        'only cannot do that',
      );
      await expect(client.scrape('https://b', { asp: true })).rejects.toThrow(
        'only cannot do that',
      );
      expect(refuser.calls).toBe(2);
    });
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
