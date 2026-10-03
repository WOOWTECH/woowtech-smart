// woowtech smart: node-pty's Windows kill() closes the pseudoconsole, and a second call closes
// it again (ClosePseudoConsole without clearing the handle), corrupting the heap and taking the
// terminal worker and every terminal down with it (node-pty #983; woowtech/README.md §25, G10).
// Upstream's close path can call kill() three times on Windows. On Windows the pty is killed
// once; a later SIGKILL ends the shell's process tree with the hidden taskkill instead of
// touching the pseudoconsole again.
import { killProcessTree } from "../utils/woowtech-process-tree-kill.js";

export interface PtyKillTarget {
  readonly pid: number;
  kill(signal?: string): void;
}

export interface PtyKiller {
  kill(signal?: NodeJS.Signals): void;
}

export function createPtyKiller(input: {
  pty: PtyKillTarget;
  platform: NodeJS.Platform;
  killTree?: (pid: number) => Promise<Error | null>;
}): PtyKiller {
  if (input.platform !== "win32") {
    return { kill: (signal) => input.pty.kill(signal) };
  }
  const killTree = input.killTree ?? ((pid: number) => killProcessTree(pid, "SIGKILL"));
  let ptyKilled = false;
  let treeKilled = false;
  return {
    kill(signal) {
      if (!ptyKilled) {
        ptyKilled = true;
        input.pty.kill();
        return;
      }
      if (signal !== "SIGKILL" || treeKilled || input.pty.pid <= 0) {
        return;
      }
      treeKilled = true;
      void killTree(input.pty.pid);
    },
  };
}

/** Opt-in bundled conpty.dll + OpenConsole (node-pty #965); WT-2 on the device decides the default. */
export function woowtechConptyOptions(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): { useConptyDll?: true } {
  return platform === "win32" && env.WOOWTECH_CONPTY_DLL === "1" ? { useConptyDll: true } : {};
}
