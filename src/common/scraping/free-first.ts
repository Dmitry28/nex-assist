import type { Logger } from '@nestjs/common';
import { sleep } from '../utils/sleep';

/**
 * One fetch policy for every protected site: free attempt first, managed chain second.
 *
 * Both Cloudflare-fronted modules (bamper, bid-cars) drive a local browser and both may fall
 * back to the provider chain, so the ordering lived twice and drifted — bamper paid before it
 * tried the free path, which burned 250 ScrapFly credits on a machine where the browser worked.
 * Keeping the policy here means a change applies to every caller.
 *
 * Order:
 *   1. one free local attempt — costs nothing and succeeds from a residential IP
 *   2. the managed chain, if any provider has a key
 *   3. the remaining free retries
 *
 * Step 3 comes last on purpose. When the browser fails because of IP reputation, retrying the
 * same address cannot help and only delays reaching a provider; but a challenge can genuinely
 * clear on a second try, so the retries are kept as a final effort rather than dropped.
 *
 * Note that "the browser cannot pass in CI" is per-site, not per-runner: measured on the same
 * GitHub Actions runners, bid.cars comes back fine while bamper.by is blocked.
 */
export interface FreeFirstOptions<T> {
  logger: Logger;
  /** Shown in log lines so a run can be traced back to a feed. */
  label: string;
  /** One free local attempt. Returns null when the page did not come back usable. */
  attemptFree: () => Promise<T | null>;
  /** Managed-chain attempt. Omit when the caller has no chain wired. */
  attemptPaid?: () => Promise<{ value: T; provider: string }>;
  /** Whether any provider holds credentials — false means the chain is skipped silently. */
  paidAvailable: boolean;
  /** Free attempts remaining after the chain has also failed. */
  retries: number;
  retryDelayMs: number;
  /** Runs before each retry, so a caller can recycle its browser. */
  beforeRetry?: () => Promise<void>;
}

/** Returns the fetched value, or null when every avenue failed. */
export const fetchFreeFirst = async <T>(options: FreeFirstOptions<T>): Promise<T | null> => {
  const { logger, label, attemptFree, attemptPaid, paidAvailable, retries, retryDelayMs } = options;

  const free = await attemptFree();
  if (free !== null) return free;

  if (attemptPaid && paidAvailable) {
    try {
      const { value, provider } = await attemptPaid();
      logger.log(`${label}: fetched via ${provider}`);
      return value;
    } catch (err) {
      // Not fatal — the free retries below are still worth a try.
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn(`${label}: scraping chain failed (${reason}) — retrying locally`);
    }
  } else if (attemptPaid) {
    logger.warn(`${label}: no scraping provider configured — retrying locally`);
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    logger.warn(`${label}: local retry ${attempt}/${retries} — waiting ${retryDelayMs / 1000}s`);
    await options.beforeRetry?.();
    await sleep(retryDelayMs);

    const retried = await attemptFree();
    if (retried !== null) return retried;
  }

  return null;
};
