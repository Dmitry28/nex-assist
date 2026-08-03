import type { Logger } from '@nestjs/common';
import { fetchEscalating } from '../escalating-fetch';

const logger = (): Logger =>
  ({ log: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as Logger;

const base = {
  logger: logger(),
  label: 'feed',
  paidAvailable: false,
  retries: 0,
  retryDelayMs: 0,
};

describe('fetchEscalating', () => {
  it('returns the browser result without touching the paid chain', async () => {
    const paid = jest.fn();
    const result = await fetchEscalating({
      ...base,
      attemptBrowser: () => Promise.resolve('free'),
      attemptPaid: paid,
      paidAvailable: true,
    });
    expect(result).toBe('free');
    // The whole point: nothing is spent when the free attempt works.
    expect(paid).not.toHaveBeenCalled();
  });

  it('falls to the chain when the browser fails', async () => {
    const result = await fetchEscalating({
      ...base,
      attemptBrowser: () => Promise.resolve(null),
      attemptPaid: () => Promise.resolve({ value: 'paid', provider: 'zenrows' }),
      paidAvailable: true,
    });
    expect(result).toBe('paid');
  });

  it('skips the chain when no provider has a key', async () => {
    const paid = jest.fn();
    const result = await fetchEscalating({
      ...base,
      attemptBrowser: () => Promise.resolve(null),
      attemptPaid: paid,
      paidAvailable: false,
    });
    expect(paid).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('retries the browser only after the chain has also failed', async () => {
    const order: string[] = [];
    let freeCalls = 0;
    const result = await fetchEscalating({
      ...base,
      retries: 1,
      attemptBrowser: () => {
        freeCalls++;
        order.push(`free${freeCalls}`);
        return Promise.resolve(freeCalls === 2 ? 'second-try' : null);
      },
      attemptPaid: () => {
        order.push('paid');
        return Promise.reject(new Error('chain down'));
      },
      paidAvailable: true,
    });
    expect(order).toEqual(['free1', 'paid', 'free2']);
    expect(result).toBe('second-try');
  });

  it('recycles the browser before each retry', async () => {
    const beforeRetry = jest.fn(() => Promise.resolve());
    await fetchEscalating({
      ...base,
      retries: 2,
      attemptBrowser: () => Promise.resolve(null),
      beforeRetry,
    });
    expect(beforeRetry).toHaveBeenCalledTimes(2);
  });

  it('returns null when everything fails, leaving the caller to decide', async () => {
    const result = await fetchEscalating({
      ...base,
      retries: 1,
      attemptBrowser: () => Promise.resolve(null),
      attemptPaid: () => Promise.reject(new Error('nope')),
      paidAvailable: true,
    });
    expect(result).toBeNull();
  });

  it('works with no chain wired at all', async () => {
    expect(await fetchEscalating({ ...base, attemptBrowser: () => Promise.resolve('ok') })).toBe(
      'ok',
    );
  });
});

describe('fetchEscalating — the plain rung', () => {
  const logger = () =>
    ({
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }) as unknown as Logger;

  it('stops at the plain request, touching neither browser nor chain', async () => {
    const browser = jest.fn();
    const paid = jest.fn();
    const result = await fetchEscalating({
      logger: logger(),
      label: 'feed',
      attemptPlain: () => Promise.resolve('plain'),
      attemptBrowser: browser,
      attemptPaid: paid,
      paidAvailable: true,
      retries: 2,
      retryDelayMs: 0,
    });
    // The cheapest rung answering must cost nothing further — that is the whole point.
    expect(result).toBe('plain');
    expect(browser).not.toHaveBeenCalled();
    expect(paid).not.toHaveBeenCalled();
  });

  it('escalates plain -> browser', async () => {
    const paid = jest.fn();
    const result = await fetchEscalating({
      logger: logger(),
      label: 'feed',
      attemptPlain: () => Promise.resolve(null),
      attemptBrowser: () => Promise.resolve('browser'),
      attemptPaid: paid,
      paidAvailable: true,
      retries: 0,
      retryDelayMs: 0,
    });
    expect(result).toBe('browser');
    expect(paid).not.toHaveBeenCalled();
  });

  it('escalates plain -> chain when a caller declares no browser rung', async () => {
    // av-by's shape: a browser was measured to fail against its WAF, so the rung is omitted.
    const result = await fetchEscalating({
      logger: logger(),
      label: 'av.by',
      attemptPlain: () => Promise.resolve(null),
      attemptPaid: () => Promise.resolve({ value: 'paid', provider: 'scrapfly' }),
      paidAvailable: true,
      retries: 0,
      retryDelayMs: 0,
    });
    expect(result).toBe('paid');
  });

  it('does not retry when there is no browser rung to retry', async () => {
    const plain = jest.fn(() => Promise.resolve(null));
    const result = await fetchEscalating({
      logger: logger(),
      label: 'av.by',
      attemptPlain: plain,
      attemptPaid: () => Promise.reject(new Error('down')),
      paidAvailable: true,
      retries: 3,
      retryDelayMs: 0,
    });
    expect(result).toBeNull();
    expect(plain).toHaveBeenCalledTimes(1);
  });
});

describe('fetchEscalating — log wording', () => {
  const make = () => ({ log: jest.fn(), warn: jest.fn(), error: jest.fn() });

  // A log that names the wrong next rung sends a diagnosis after a failure that never happened.
  it('names the browser when a browser rung exists', async () => {
    const logger = make();
    await fetchEscalating({
      logger: logger as unknown as Logger,
      label: 'f',
      attemptPlain: () => Promise.resolve(null),
      attemptBrowser: () => Promise.resolve('x'),
      paidAvailable: false,
      retries: 0,
      retryDelayMs: 0,
    });
    expect(logger.warn.mock.calls[0][0]).toContain('trying a browser');
  });

  it('names the provider chain when the caller declares no browser', async () => {
    const logger = make();
    await fetchEscalating({
      logger: logger as unknown as Logger,
      label: 'av.by',
      attemptPlain: () => Promise.resolve(null),
      attemptPaid: () => Promise.resolve({ value: 'x', provider: 'zenrows' }),
      paidAvailable: true,
      retries: 0,
      retryDelayMs: 0,
    });
    expect(logger.warn.mock.calls[0][0]).toContain('trying the provider chain');
  });
});
