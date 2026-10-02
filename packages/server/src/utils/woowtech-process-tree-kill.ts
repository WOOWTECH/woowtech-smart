// woowtech smart: tree-kill 1.2.2 runs `taskkill /pid N /T /F` through cmd.exe without
// windowsHide. The daemon has no console of its own, so on Windows every kill flashed a
// console window (woowtech/README.md §25, G11). Run taskkill.exe directly and hidden.
// tree-kill ignores the signal on Windows and always forces the whole tree; so does this.
import { execFile } from "node:child_process";
import path from "node:path";
import treeKill from "tree-kill";

export interface ProcessTreeKillDeps {
  platform: NodeJS.Platform;
  systemRoot: string | undefined;
  execFile(
    file: string,
    args: string[],
    options: { windowsHide: boolean },
    callback: (error: Error | null) => void,
  ): void;
  treeKill(pid: number, signal: string, callback: (error?: Error) => void): void;
}

const defaultDeps: ProcessTreeKillDeps = {
  platform: process.platform,
  systemRoot: process.env.SystemRoot,
  execFile: (file, args, options, callback) => {
    execFile(file, args, options, (error) => callback(error));
  },
  treeKill: (pid, signal, callback) => treeKill(pid, signal, callback),
};

/** System32's taskkill, not whatever `taskkill` the PATH resolves to first. */
export function windowsTaskkillPath(systemRoot: string | undefined): string {
  return path.win32.join(systemRoot || "C:\\Windows", "System32", "taskkill.exe");
}

/** Resolves with the error tree-kill would have reported, or null. Never rejects. */
export function killProcessTree(
  pid: number,
  signal: string,
  deps: ProcessTreeKillDeps = defaultDeps,
): Promise<Error | null> {
  return new Promise((resolve) => {
    if (deps.platform === "win32") {
      deps.execFile(
        windowsTaskkillPath(deps.systemRoot),
        ["/pid", String(pid), "/T", "/F"],
        { windowsHide: true },
        (error) => resolve(error ?? null),
      );
      return;
    }
    deps.treeKill(pid, signal, (error) => resolve(error ?? null));
  });
}
