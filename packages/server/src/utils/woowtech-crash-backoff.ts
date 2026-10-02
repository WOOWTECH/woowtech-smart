// woowtech smart: a daemon worker that keeps crashing right after it starts was restarted
// at once, forever. On Windows each restart can also open a console window (getpaseo #3333;
// woowtech/README.md §25, G12). The first crash after a stable run still restarts at once;
// crashes in a row wait 1 s, 2 s, 4 s … up to 30 s.

export interface CrashBackoffOptions {
  baseDelayMs: number;
  maxDelayMs: number;
  /** A worker that ran this long resets the count. */
  stableUptimeMs: number;
}

export const DEFAULT_CRASH_BACKOFF: CrashBackoffOptions = {
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  stableUptimeMs: 60_000,
};

export interface CrashBackoff {
  /** Delay before restarting a worker that crashed after running `uptimeMs`. */
  nextDelayMs(uptimeMs: number): number;
}

export function createCrashBackoff(
  options: CrashBackoffOptions = DEFAULT_CRASH_BACKOFF,
): CrashBackoff {
  let crashesInARow = 0;
  return {
    nextDelayMs(uptimeMs) {
      if (uptimeMs >= options.stableUptimeMs) {
        crashesInARow = 0;
      }
      const delay =
        crashesInARow === 0
          ? 0
          : Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** (crashesInARow - 1));
      crashesInARow += 1;
      return delay;
    },
  };
}
