// woowtech smart (woowtech/README.md section 25): a worker inherits the supervisor's working
// directory. When that directory was removed after the daemon started (a deleted project or
// temporary folder it was started from), the next worker's first process.cwd() threw ENOENT, the
// worker exited before it was ready, and the supervisor gave up: restarting the daemon from the
// app's settings left it stopped (2026-10-08). The worker then starts in the home directory.
import { existsSync } from "node:fs";
import { homedir } from "node:os";

export interface WorkerCwdPorts {
  cwd: () => string;
  exists: (path: string) => boolean;
  home: () => string;
}

const SYSTEM: WorkerCwdPorts = {
  cwd: () => process.cwd(),
  exists: existsSync,
  home: homedir,
};

/**
 * The directory to start a worker in: undefined (inherit the supervisor's) while that still
 * exists, else the home directory. Node caches process.cwd(), so a removed directory can still be
 * returned by name; it is checked on disk.
 */
export function workerCwd(ports: WorkerCwdPorts = SYSTEM): string | undefined {
  let current: string;
  try {
    current = ports.cwd();
  } catch {
    return ports.home();
  }
  return ports.exists(current) ? undefined : ports.home();
}
