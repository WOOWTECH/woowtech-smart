// woowtech smart: cmd.exe's PATH and PATHEXT search, without the current folder (plan G17, G28).
// cmd.exe and the `which` package look in the current folder first on Windows, and the daemon runs
// tools by name inside users' project folders, so a project carrying gh.cmd would have it run.
// Relative PATH entries resolve against the current folder too, so they are skipped as well.
import { lstatSync } from "node:fs";
import path from "node:path";

// The extensions CreateProcess (.com, .exe) or cmd.exe (.bat, .cmd) can start. Other PATHEXT
// entries (.js, .vbs) open through file associations, which a spawn cannot use.
const RUNNABLE_EXTENSIONS = new Set([".com", ".exe", ".bat", ".cmd"]);
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

export interface WindowsPathSearch {
  /** A bare program name such as "gh" or "git.exe"; a path returns null. */
  name: string;
  /** Path/PATH and PATHEXT, read whatever their case. */
  env: Record<string, string | undefined>;
  /** lstat-based by default, so App Execution Aliases (reparse points) count. */
  exists?: (filePath: string) => boolean;
}

export function findOnWindowsPath(options: WindowsPathSearch): string | null {
  const trimmed = options.name.trim();
  if (!trimmed || /[\\/:]/.test(trimmed)) {
    return null;
  }
  const exists = options.exists ?? windowsFileExists;
  const extension = path.win32.extname(trimmed).toLowerCase();
  const names = RUNNABLE_EXTENSIONS.has(extension)
    ? [trimmed]
    : runnableExtensions(readWindowsEnv(options.env, "PATHEXT")).map((ext) => `${trimmed}${ext}`);
  for (const folder of pathFolders(readWindowsEnv(options.env, "PATH"))) {
    for (const candidate of names) {
      const filePath = path.win32.join(folder, candidate);
      if (exists(filePath)) {
        return filePath;
      }
    }
  }
  return null;
}

/** Reads a Windows environment variable from a plain object, whatever the key's case. */
export function readWindowsEnv(
  env: Record<string, string | undefined>,
  name: string,
): string | undefined {
  const upper = name.toUpperCase();
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === upper);
  return key === undefined ? undefined : env[key];
}

function runnableExtensions(pathExt: string | undefined): string[] {
  const listed = (pathExt?.trim() ? pathExt : DEFAULT_PATHEXT)
    .split(";")
    .map((ext) => ext.trim().toLowerCase())
    .filter((ext) => RUNNABLE_EXTENSIONS.has(ext));
  return [...new Set(listed)];
}

function pathFolders(pathValue: string | undefined): string[] {
  return (pathValue ?? "")
    .split(";")
    .map((entry) => entry.replaceAll('"', "").trim())
    .filter((entry) => entry !== "" && path.win32.isAbsolute(entry));
}

/** lstat-based, so App Execution Aliases (reparse points) count; folders do not. */
export function windowsFileExists(filePath: string): boolean {
  try {
    return !lstatSync(filePath).isDirectory();
  } catch {
    return false;
  }
}
