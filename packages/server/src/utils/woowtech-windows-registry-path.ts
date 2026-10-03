// woowtech smart: a program installed while the app runs is found on Windows too (plan G29).
// The app and daemon keep the PATH Explorer gave them at start, and since the app lives in the
// tray (G1) that can be days old. Installers add their folders to the saved PATH in the registry
// (npm, WinGet links, GitHub CLI, Claude's .local\bin), so after a failed lookup the saved
// machine and user PATH are read again and folders the process lacks are appended. Nothing is
// removed or reordered. macOS resolves its login shell's PATH once at start (login-shell-env.ts).
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface RegistryPaths {
  /** HKLM ...\Session Manager\Environment\Path, expanded; null when unset. */
  machine: string | null;
  /** HKCU\Environment\Path, expanded; null when unset. */
  user: string | null;
}

interface ExecFileTextOptions {
  windowsHide: boolean;
  timeout: number;
  encoding: "utf8";
  maxBuffer: number;
}

type ExecFileText = (
  file: string,
  args: string[],
  options: ExecFileTextOptions,
) => Promise<{ stdout: string; stderr: string }>;

export interface RegistryPathReaderDeps {
  execFile?: ExecFileText;
  systemRoot?: string;
  timeoutMs?: number;
}

// GetEnvironmentVariable expands REG_EXPAND_SZ values. UTF-8 JSON avoids decoding reg.exe output
// in the console code page, which breaks on Chinese user names.
const READ_PATHS_SCRIPT = [
  "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false",
  "[ordered]@{",
  "  machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')",
  "  user = [Environment]::GetEnvironmentVariable('Path', 'User')",
  "} | ConvertTo-Json -Compress",
].join("\n");

export async function readRegistryPaths(deps: RegistryPathReaderDeps = {}): Promise<RegistryPaths> {
  const systemRoot = deps.systemRoot ?? process.env.SystemRoot ?? "C:\\Windows";
  const powershell = path.win32.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const run = deps.execFile ?? runExecFile;
  const { stdout } = await run(
    powershell,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(READ_PATHS_SCRIPT, "utf16le").toString("base64"),
    ],
    {
      windowsHide: true,
      timeout: deps.timeoutMs ?? 5000,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    },
  );
  const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
  return {
    machine: typeof parsed.machine === "string" ? parsed.machine : null,
    user: typeof parsed.user === "string" ? parsed.user : null,
  };
}

function runExecFile(
  file: string,
  args: string[],
  options: ExecFileTextOptions,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(file, args, options);
}

export interface PathMerge {
  current: string;
  fresh: RegistryPaths;
}

export interface MergedPath {
  path: string;
  added: string[];
}

function folderKey(entry: string): string {
  return entry
    .replaceAll('"', "")
    .trim()
    .replace(/[\\/]+$/, "")
    .toLowerCase();
}

/** Appends saved machine, then user folders that `current` lacks, in Windows' logon order. */
export function mergeRegistryPath(input: PathMerge): MergedPath {
  const seen = new Set(input.current.split(";").map(folderKey));
  const added: string[] = [];
  for (const saved of [input.fresh.machine, input.fresh.user]) {
    for (const raw of (saved ?? "").split(";")) {
      const entry = raw.trim();
      // A folder still holding %VAR% names a variable this process cannot expand.
      if (entry === "" || entry.includes("%") || seen.has(folderKey(entry))) continue;
      seen.add(folderKey(entry));
      added.push(entry);
    }
  }
  if (added.length === 0) {
    return { path: input.current, added };
  }
  const kept = input.current.replace(/;+$/, "");
  return { path: [...(kept === "" ? [] : [kept]), ...added].join(";"), added };
}

export interface WindowsPathRefresher {
  /** Reads the saved PATH (at most every minIntervalMs) and appends what is new. */
  refresh(): Promise<void>;
  /** Increases whenever a refresh changed PATH. */
  pathVersion(): number;
}

export interface WindowsPathRefresherDeps {
  platform: NodeJS.Platform;
  /** The environment to update: process.env, whose keys are case-insensitive on Windows. */
  env: Record<string, string | undefined>;
  read: () => Promise<RegistryPaths>;
  now: () => number;
  minIntervalMs: number;
  log?: (message: string, fields: Record<string, unknown>) => void;
}

export function createWindowsPathRefresher(deps: WindowsPathRefresherDeps): WindowsPathRefresher {
  let lastReadAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<void> | null = null;
  let version = 0;
  let failureLogged = false;

  async function readAndMerge(): Promise<void> {
    try {
      const fresh = await deps.read();
      const key = Object.keys(deps.env).find((name) => name.toUpperCase() === "PATH") ?? "Path";
      const merged = mergeRegistryPath({ current: deps.env[key] ?? "", fresh });
      if (merged.added.length > 0) {
        deps.env[key] = merged.path;
        version += 1;
        deps.log?.("[woowtech] PATH refreshed from registry", { added: merged.added });
      }
    } catch (error) {
      if (!failureLogged) {
        failureLogged = true;
        deps.log?.("[woowtech] PATH refresh failed", { error: String(error) });
      }
    } finally {
      inFlight = null;
    }
  }

  return {
    refresh() {
      if (deps.platform !== "win32") return Promise.resolve();
      if (inFlight) return inFlight;
      if (deps.now() - lastReadAt < deps.minIntervalMs) return Promise.resolve();
      lastReadAt = deps.now();
      inFlight = readAndMerge();
      return inFlight;
    },
    pathVersion: () => version,
  };
}

/** One per process; it updates process.env, so programs started afterwards inherit it. */
export const processWindowsPathRefresher = createWindowsPathRefresher({
  platform: process.platform,
  env: process.env,
  read: () => readRegistryPaths(),
  now: () => Date.now(),
  minIntervalMs: 10_000,
  log: (message, fields) => console.info(message, fields),
});

export interface RefreshingLookup<T> {
  lookup: () => Promise<T | null>;
  refresher?: WindowsPathRefresher;
}

/** Runs the lookup; on a miss, refreshes PATH and looks once more if PATH changed meanwhile. */
export async function findWithWindowsPathRefresh<T>(input: RefreshingLookup<T>): Promise<T | null> {
  const refresher = input.refresher ?? processWindowsPathRefresher;
  const version = refresher.pathVersion();
  const found = await input.lookup();
  if (found !== null) {
    return found;
  }
  await refresher.refresh();
  return refresher.pathVersion() === version ? null : input.lookup();
}
