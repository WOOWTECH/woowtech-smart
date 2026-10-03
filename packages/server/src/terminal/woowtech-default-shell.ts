// woowtech smart: the shell a new terminal opens (woowtech/README.md §25, plan G27, D16).
// macOS opens the user's $SHELL. Upstream opens cmd.exe on Windows; Windows Terminal opens
// PowerShell, and upstream already runs worktree setup commands in Windows PowerShell, so here
// Windows opens PowerShell 7 when installed, else Windows PowerShell, else cmd.exe.
// WOOWTECH_TERMINAL_SHELL picks another, as $SHELL does on the Mac. -NoLogo drops the banner,
// which costs four lines on a phone; the user's profile still loads.
import path from "node:path";

import {
  findOnWindowsPath,
  readWindowsEnv,
  windowsFileExists,
} from "../utils/woowtech-windows-path-search.js";
import {
  processWindowsPathRefresher,
  type WindowsPathRefresher,
} from "../utils/woowtech-windows-registry-path.js";

export const TERMINAL_SHELL_OVERRIDE = "WOOWTECH_TERMINAL_SHELL";
const REFRESH_WAIT_MS = 2_000;

export interface DefaultShellLaunch {
  command: string;
  args: string[];
}

interface UpstreamShellOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

export interface DefaultShellRequest {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** lstat-based by default, so the Store's pwsh alias counts. */
  isFile?: (filePath: string) => boolean;
  /** Upstream's resolveDefaultTerminalShell: $SHELL, or %ComSpec% on Windows. */
  upstreamDefault: (options: UpstreamShellOptions) => string;
}

export function resolveWoowtechDefaultShell(request: DefaultShellRequest): DefaultShellLaunch {
  const platform = request.platform ?? process.platform;
  const env = request.env ?? process.env;
  if (platform !== "win32") {
    return { command: request.upstreamDefault({ platform, env }), args: [] };
  }
  const override = readWindowsEnv(env, TERMINAL_SHELL_OVERRIDE)?.trim();
  if (override) {
    return { command: override, args: [] };
  }
  const isFile = request.isFile ?? windowsFileExists;
  const programFiles = readWindowsEnv(env, "ProgramFiles");
  const localAppData = readWindowsEnv(env, "LOCALAPPDATA");
  const systemRoot = readWindowsEnv(env, "SystemRoot") ?? "C:\\Windows";
  // pwsh from PATH, its default install, the Store copy; then Windows PowerShell.
  const candidates = [
    programFiles ? path.win32.join(programFiles, "PowerShell", "7", "pwsh.exe") : null,
    localAppData ? path.win32.join(localAppData, "Microsoft", "WindowsApps", "pwsh.exe") : null,
    path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
  ].filter((candidate): candidate is string => candidate !== null);
  const powerShell =
    findOnWindowsPath({ name: "pwsh", env, exists: isFile }) ?? candidates.find(isFile);
  if (powerShell) {
    return { command: powerShell, args: ["-NoLogo"] };
  }
  return { command: request.upstreamDefault({ platform, env }), args: [] };
}

export interface PrepareShellRequest extends DefaultShellRequest {
  /** A shell the caller chose; it is used as is. */
  shell?: string;
  refresher?: WindowsPathRefresher;
}

/**
 * The launch for a new interactive terminal. On Windows it first re-reads the saved PATH (at
 * most two seconds), so a new terminal finds tools installed after the daemon started, like a
 * new Windows Terminal tab (plan G29).
 */
export async function prepareWoowtechDefaultShell(
  request: PrepareShellRequest,
): Promise<DefaultShellLaunch> {
  if (request.shell) {
    return { command: request.shell, args: [] };
  }
  const platform = request.platform ?? process.platform;
  if (platform === "win32") {
    const refresher = request.refresher ?? processWindowsPathRefresher;
    await Promise.race([refresher.refresh(), delay(REFRESH_WAIT_MS)]);
  }
  return resolveWoowtechDefaultShell({
    platform,
    env: request.env,
    isFile: request.isFile,
    upstreamDefault: request.upstreamDefault,
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
}
