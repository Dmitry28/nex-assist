import { withTimeout } from './with-timeout';

describe('withTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('resolves with the value when the work settles in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1_000, 'job')).resolves.toBe('ok');
  });

  it('passes through the work rejection', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1_000, 'job')).rejects.toThrow(
      'boom',
    );
  });

  it('rejects with the label when the work hangs', async () => {
    const result = withTimeout(new Promise<never>(() => undefined), 2_000, 'job');
    const assertion = expect(result).rejects.toThrow('job timed out after 2s');
    await jest.advanceTimersByTimeAsync(2_000);
    await assertion;
  });

  it('leaves no pending timer once the work has settled', async () => {
    await withTimeout(Promise.resolve(1), 1_000, 'job');
    expect(jest.getTimerCount()).toBe(0);
  });
});
