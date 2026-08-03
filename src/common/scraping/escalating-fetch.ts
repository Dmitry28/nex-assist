import type { Logger } from '@nestjs/common';
import { sleep } from '../utils/sleep';

/**
 * One escalation ladder for every site, cheapest rung first.
 *
 *   1. plain HTTP fetch   free,  ~1s   — works for kufar, realt, prometr, ghb, pogorany
 *   2. local browser      free,  ~9s   — needed where a plain fetch meets a JS challenge
 *   3. managed chain      paid        — needed where even a browser is refused
 *
 * A rung is only reached when the one above it fails, so a site that answers a plain request
 * never costs anything, and a site that needs residential proxies still gets them. The per-site
 * differences that used to live as separate code paths — av-by going straight to providers,
 * bamper starting at the browser — become which rungs a caller declares.
 *
 * A caller omits a rung it has measured to be useless: a browser cannot clear av.by's SafeLine
 * WAF (8 KB, no data), so paying ~9s per feed to prove that again every run would be waste.
 * The omission belongs in the caller with its reason, not as a branch in here.
 *
 * Free retries come last, after the paid rung. When a browser fails on IP reputation, retrying
 * the same address cannot help and only delays reaching a provider — but a challenge can
 * genuinely clear on a second try, so they are kept as a final effort.
 */
export interface EscalatingFetchOptions<T> {
  logger: Logger;
  /** Shown in log lines so a run can be traced back to a feed. */
  label: string;
  /** Rung 1. Returns null when the response was not usable. */
  attemptPlain?: () => Promise<T | null>;
  /** Rung 2. Returns null when the challenge did not clear. */
  attemptBrowser?: () => Promise<T | null>;
  /** Rung 3. */
  attemptPaid?: () => Promise<{ value: T; provider: string }>;
  /** Whether any provider holds credentials — false means rung 3 is skipped silently. */
  paidAvailable: boolean;
  /** Browser retries after the paid rung has also failed. */
  retries: number;
  retryDelayMs: number;
  /** Runs before each retry, so a caller can recycle its browser. */
  beforeRetry?: () => Promise<void>;
}

/** Returns the fetched value, or null when every declared rung failed. */
export const fetchEscalating = async <T>(o: EscalatingFetchOptions<T>): Promise<T | null> => {
  if (o.attemptPlain) {
    const plain = await o.attemptPlain();
    if (plain !== null) return plain;
    // Name the rung actually coming next: av-by declares no browser, and a log that claimed
    // otherwise would send a diagnosis looking for a browser failure that never happened.
    const next = o.attemptBrowser ? 'a browser' : o.attemptPaid ? 'the provider chain' : 'nothing';
    o.logger.warn(`${o.label}: plain request did not return usable content — trying ${next}`);
  }

  if (o.attemptBrowser) {
    const viaBrowser = await o.attemptBrowser();
    if (viaBrowser !== null) return viaBrowser;
  }

  if (o.attemptPaid && o.paidAvailable) {
    try {
      const { value, provider } = await o.attemptPaid();
      o.logger.log(`${o.label}: fetched via ${provider}`);
      return value;
    } catch (err) {
      // Not fatal — the browser retries below are still worth a try.
      const reason = err instanceof Error ? err.message : String(err);
      o.logger.warn(`${o.label}: scraping chain failed (${reason})`);
    }
  } else if (o.attemptPaid) {
    o.logger.warn(`${o.label}: no scraping provider configured`);
  }

  if (!o.attemptBrowser) return null;

  for (let attempt = 1; attempt <= o.retries; attempt++) {
    o.logger.warn(
      `${o.label}: browser retry ${attempt}/${o.retries} — waiting ${o.retryDelayMs / 1000}s`,
    );
    await o.beforeRetry?.();
    await sleep(o.retryDelayMs);

    const retried = await o.attemptBrowser();
    if (retried !== null) return retried;
  }

  return null;
};
