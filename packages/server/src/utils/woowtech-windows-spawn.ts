// woowtech smart: how the daemon starts a program on Windows (woowtech/README.md §31, plan G17,
// G30). Upstream runs .cmd/.bat files and bare names through cmd.exe, which looks in the current
// folder first, re-parses every argument and cuts them at line breaks. Here a bare name is found on
// PATH without the current folder; a program starts directly, so its arguments arrive as written;
// an npm shim's real program starts directly too; any other batch file still needs cmd.exe and
// gets arguments escaped for it. Anything this cannot place keeps upstream's way.
import path from "node:path";

import { buildCmdShimCommandLine } from "./woowtech-cmd-escape.js";
import { readNpmCmdShimTarget } from "./woowtech-npm-cmd-shim.js";
import {
  findOnWindowsPath,
  readWindowsEnv,
  windowsFileExists,
} from "./woowtech-windows-path-search.js";

/** Set to 1 to send every spawn back through upstream's cmd.exe path, for field debugging. */
export const LEGACY_WINDOWS_SPAWN = "WOOWTECH_LEGACY_WINDOWS_SPAWN";

const PROGRAM_EXTENSIONS = new Set([".exe", ".com"]);
const SCRIPT_EXTENSIONS = new Set([".cmd", ".bat"]);

export interface DirectWindowsSpawn {
  via: "direct" | "npm-shim" | "cmd-script";
  command: string;
  args: string[];
  windowsVerbatimArguments: boolean;
}

export type WindowsSpawnPlan = { via: "upstream" } | DirectWindowsSpawn;

export interface WindowsSpawnRequest {
  command: string;
  args: readonly string[];
  /** The caller's `shell` option. A shell the caller asked for keeps upstream's way. */
  requestedShell?: boolean | string;
  /** The child's environment: its PATH and PATHEXT decide what a bare name means. */
  env: Record<string, string | undefined>;
  exists?: (filePath: string) => boolean;
  readFile?: (filePath: string) => string;
}

export interface PlatformSpawnRequest extends WindowsSpawnRequest {
  platform: NodeJS.Platform;
}

/** For spawn.ts: the planned start on Windows, or null to keep upstream's way. */
export function planDirectWindowsSpawn(request: PlatformSpawnRequest): DirectWindowsSpawn | null {
  if (request.platform !== "win32") {
    return null;
  }
  const plan = planWindowsSpawn(request);
  return plan.via === "upstream" ? null : plan;
}

export function planWindowsSpawn(request: WindowsSpawnRequest): WindowsSpawnPlan {
  if (
    request.requestedShell === true ||
    typeof request.requestedShell === "string" ||
    readWindowsEnv(request.env, LEGACY_WINDOWS_SPAWN) === "1"
  ) {
    return { via: "upstream" };
  }
  const target = resolveTarget(request);
  if (!target) {
    return { via: "upstream" };
  }
  const args = [...request.args];
  const extension = path.win32.extname(target).toLowerCase();
  if (PROGRAM_EXTENSIONS.has(extension)) {
    return { via: "direct", command: target, args, windowsVerbatimArguments: false };
  }
  if (!SCRIPT_EXTENSIONS.has(extension)) {
    return { via: "upstream" };
  }
  return planNpmShim(target, request) ?? planCmdScript(target, request);
}

function resolveTarget(request: WindowsSpawnRequest): string | null {
  const command = request.command.trim();
  if (/[\\/]/.test(command)) {
    // A relative path means the child's cwd, which is not ours to check: upstream handles it.
    return path.win32.isAbsolute(command) && (request.exists ?? windowsFileExists)(command)
      ? command
      : null;
  }
  return findOnWindowsPath({ name: command, env: request.env, exists: request.exists });
}

function planNpmShim(script: string, request: WindowsSpawnRequest): WindowsSpawnPlan | null {
  const exists = request.exists ?? windowsFileExists;
  const shim = readNpmCmdShimTarget({ shimPath: script, readFile: request.readFile });
  if (shim?.kind === "executable" && exists(shim.path)) {
    return {
      via: "npm-shim",
      command: shim.path,
      args: [...request.args],
      windowsVerbatimArguments: false,
    };
  }
  if (shim?.kind !== "node-script" || !exists(shim.script)) {
    return null;
  }
  // The shim prefers a node.exe next to itself, then node from PATH (without .js in PATHEXT).
  const node = exists(shim.bundledNode)
    ? shim.bundledNode
    : findOnWindowsPath({ name: "node", env: request.env, exists: request.exists });
  if (!node || !PROGRAM_EXTENSIONS.has(path.win32.extname(node).toLowerCase())) {
    return null;
  }
  return {
    via: "npm-shim",
    command: node,
    args: [...shim.nodeArgs, shim.script, ...request.args],
    windowsVerbatimArguments: false,
  };
}

function planCmdScript(script: string, request: WindowsSpawnRequest): WindowsSpawnPlan {
  const systemRoot = readWindowsEnv(request.env, "SystemRoot") ?? "C:\\Windows";
  const comSpec =
    readWindowsEnv(request.env, "ComSpec") ?? path.win32.join(systemRoot, "System32", "cmd.exe");
  return {
    via: "cmd-script",
    command: comSpec,
    args: [buildCmdShimCommandLine({ script, args: request.args })],
    windowsVerbatimArguments: true,
  };
}
