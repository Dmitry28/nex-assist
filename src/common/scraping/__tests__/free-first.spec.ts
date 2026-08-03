import type { Logger } from '@nestjs/common';
import { fetchFreeFirst } from '../free-first';

const logger = (): Logger =>
  ({ log: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as Logger;

const base = {
  logger: logger(),
  label: 'feed',
  paidAvailable: false,
  retries: 0,
  retryDelayMs: 0,
};

describe('fetchFreeFirst', () => {
  it('returns the free result without touching the paid chain', async () => {
    const paid = jest.fn();
    const result = await fetchFreeFirst({
      ...base,
      attemptFree: () => Promise.resolve('free'),
      attemptPaid: paid,
      paidAvailable: true,
    });
    expect(result).toBe('free');
    // The whole point: nothing is spent when the free attempt works.
    expect(paid).not.toHaveBeenCalled();
  });

  it('falls to the chain when the free attempt fails', async () => {
    const result = await fetchFreeFirst({
      ...base,
      attemptFree: () => Promise.resolve(null),
      attemptPaid: () => Promise.resolve({ value: 'paid', provider: 'zenrows' }),
      paidAvailable: true,
    });
    expect(result).toBe('paid');
  });

  it('skips the chain when no provider has a key', async () => {
    const paid = jest.fn();
    const result = await fetchFreeFirst({
      ...base,
      attemptFree: () => Promise.resolve(null),
      attemptPaid: paid,
      paidAvailable: false,
    });
    expect(paid).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('retries the free path only after the chain has also failed', async () => {
    const order: string[] = [];
    let freeCalls = 0;
    const result = await fetchFreeFirst({
      ...base,
      retries: 1,
      attemptFree: () => {
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
    await fetchFreeFirst({
      ...base,
      retries: 2,
      attemptFree: () => Promise.resolve(null),
      beforeRetry,
    });
    expect(beforeRetry).toHaveBeenCalledTimes(2);
  });

  it('returns null when everything fails, leaving the caller to decide', async () => {
    const result = await fetchFreeFirst({
      ...base,
      retries: 1,
      attemptFree: () => Promise.resolve(null),
      attemptPaid: () => Promise.reject(new Error('nope')),
      paidAvailable: true,
    });
    expect(result).toBeNull();
  });

  it('works with no chain wired at all', async () => {
    expect(await fetchFreeFirst({ ...base, attemptFree: () => Promise.resolve('ok') })).toBe('ok');
  });
});
