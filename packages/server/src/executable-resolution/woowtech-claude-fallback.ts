// woowtech smart: where the daemon looks for the user's `claude` when PATH has none.
// The desktop app started from the Dock gets the login shell's PATH, which may not
// include ~/.local/bin, where Claude Code's native installer puts `claude`. Only the
// built-in default command gets these locations; a command the user set is resolved
// exactly as upstream resolves it. woowtech/README.md section 3 has the order.
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { findExecutable, probeExecutable } from "./executable-resolution.js";

export interface ClaudeExecutableIo {
  platform: NodeJS.Platform;
  /** The daemon's home directory, which `~` stands for in the locations. */
  homeDir: () => string;
  /** The directory the system-wide locations sit under: "/" except in tests. */
  rootDir: string;
  /** Upstream's PATH search: `which -a`, then the --version probe on each candidate. */
  findOnPath: (name: string) => Promise<string | null>;
}

/** The directories `~` and the system-wide locations resolve against. */
export interface ClaudeLocationRoots {
  homeDir: string;
  rootDir: string;
}

/** A launch default in the shape checkProviderLaunchAvailable takes. */
export interface ClaudeLaunchDefault {
  command: string;
  resolvePath: () => Promise<string | null>;
}

export const realClaudeExecutableIo: ClaudeExecutableIo = {
  platform: process.platform,
  homeDir: () => os.homedir(),
  rootDir: "/",
  findOnPath: (name) => findExecutable(name),
};

/** Where Claude Code's installers put `claude`, in the order the daemon tries them. */
export function claudeFallbackLocations({ homeDir, rootDir }: ClaudeLocationRoots): string[] {
  return [
    path.join(homeDir, ".local", "bin", "claude"),
    path.join(homeDir, ".claude", "local", "claude"),
    path.join(rootDir, "opt", "homebrew", "bin", "claude"),
    path.join(rootDir, "usr", "local", "bin", "claude"),
  ];
}

/** A regular file, or a symlink to one, that this user may execute. */
async function isExecutableFile(filePath: string): Promise<boolean> {
  try {
    if (!(await stat(filePath)).isFile()) {
      return false;
    }
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The default `claude`: the first usable one on PATH, else the first fallback
 * location holding an executable file that passes the same --version probe.
 * A failing PATH lookup (not a missing command) still throws, as upstream's does.
 */
export async function findDefaultClaudeExecutable(
  io: ClaudeExecutableIo = realClaudeExecutableIo,
): Promise<string | null> {
  const onPath = await io.findOnPath("claude");
  if (onPath) {
    return onPath;
  }
  // The locations are POSIX install paths; Windows is not in v1.
  if (io.platform === "win32") {
    return null;
  }
  for (const location of claudeFallbackLocations({ homeDir: io.homeDir(), rootDir: io.rootDir })) {
    if ((await isExecutableFile(location)) && (await probeExecutable(location))) {
      return location;
    }
  }
  return null;
}

/**
 * The launch default checkProviderLaunchAvailable uses for a built-in command
 * when its caller passes none: only `claude` has one.
 */
export function builtinLaunchDefault(
  command: string,
  io: ClaudeExecutableIo = realClaudeExecutableIo,
): ClaudeLaunchDefault | undefined {
  if (command !== "claude") {
    return undefined;
  }
  return { command, resolvePath: () => findDefaultClaudeExecutable(io) };
}
