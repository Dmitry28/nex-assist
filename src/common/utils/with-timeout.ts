/**
 * Rejects with `Error("<label> timed out after <n>s")` if `work` has not settled in `ms`.
 * It cannot cancel `work` — a hung promise is only abandoned, not stopped — so the caller must
 * not rely on the abandoned work releasing anything.
 */
export function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
