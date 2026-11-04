// woowtech smart: the --version probe for Windows lookups (plan G14). Upstream counts a probe
// that times out as found. On Windows that accepts a candidate that never answers, such as a
// Claude Desktop alias that opens its window instead (H4 §1.1). Here a timeout is a miss, and the
// timeout is at least 10 s, so Defender's first scan of a large new binary still fits.
import { execCommand } from "../utils/spawn.js";
import { isWindowsCommandScript } from "../utils/windows-command.js";

export const WINDOWS_MIN_PROBE_TIMEOUT_MS = 10_000;

export type ExecutableProbe = (executablePath: string, timeoutMs: number) => Promise<boolean>;

export interface WindowsProbeOptions {
  minTimeoutMs: number;
}

export function createWindowsProbe(options: WindowsProbeOptions): ExecutableProbe {
  return async (executablePath, timeoutMs) => {
    try {
      await execCommand(executablePath, ["--version"], {
        timeout: Math.max(timeoutMs, options.minTimeoutMs),
        killSignal: "SIGKILL",
        maxBuffer: 64 * 1024,
        shell: isWindowsCommandScript(executablePath),
      });
      return true;
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & { killed?: boolean };
      // An exit code means it ran; killed means it never answered.
      return !failure.killed && typeof failure.code === "number";
    }
  };
}

export const probeWindowsExecutable = createWindowsProbe({
  minTimeoutMs: WINDOWS_MIN_PROBE_TIMEOUT_MS,
});
