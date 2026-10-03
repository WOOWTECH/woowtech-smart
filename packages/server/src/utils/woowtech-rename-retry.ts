// woowtech smart: on Windows a rename can fail for a moment while Defender or the indexer holds a
// file it just saw (EPERM, EACCES, EBUSY), for example a freshly unpacked SDK folder (plan G15).
// Those errors are retried with growing waits; anything else, and every error on other systems,
// fails at once.
import { rename as fsRename } from "node:fs/promises";

const RETRIED = new Set(["EPERM", "EACCES", "EBUSY"]);
const WINDOWS_DELAYS_MS = [50, 100, 200, 400, 800, 1600, 1600] as const;

export interface RenameRetry {
  from: string;
  to: string;
  platform?: NodeJS.Platform;
  rename?: (from: string, to: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

export async function renameWithRetry(input: RenameRetry): Promise<void> {
  const rename = input.rename ?? fsRename;
  const sleep = input.sleep ?? defaultSleep;
  const delays = (input.platform ?? process.platform) === "win32" ? WINDOWS_DELAYS_MS : [];
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(input.from, input.to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= delays.length || !code || !RETRIED.has(code)) {
        throw error;
      }
      await sleep(delays[attempt]);
    }
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
