// woowtech smart: finds what an npm-generated .cmd shim runs, so the daemon can start that program
// itself instead of going through cmd.exe (plan G30). Claude, Codex and OpenCode installed with
// npm are such shims. Only the exact templates of npm's cmd-shim (4.1 and later, npm 7+) are
// recognized; anything else, including shims that set environment variables or use another
// interpreter, returns null and keeps running through cmd.exe.
import { readFileSync } from "node:fs";
import path from "node:path";

export type NpmCmdShimTarget =
  | { kind: "node-script"; script: string; nodeArgs: string[]; bundledNode: string }
  | { kind: "executable"; path: string };

const HEAD = [
  "@echo off",
  "goto start",
  ":find_dp0",
  "set dp0=%~dp0",
  "exit /b",
  ":start",
  "setlocal",
  "call :find_dp0",
];
const NODE_BRANCH = [
  'if exist "%dp0%\\node.exe" (',
  'set "_prog=%dp0%\\node.exe"',
  ") else (",
  'set "_prog=node"',
  "set pathext=%pathext:;.js;=;%",
  ")",
];
const NODE_RUN =
  /^(?:endlocal & goto #_undefined_# 2>nul \|\| title %comspec% & )?"%_prog%" (.*?) ?"%dp0%\\([^"%]+)" %\*$/i;
const BINARY_RUN = /^"%dp0%\\([^"%]+)" +%\*$/i;
const PROGRAM_EXTENSIONS = new Set([".exe", ".com"]);

export interface NpmCmdShimRead {
  shimPath: string;
  readFile?: (filePath: string) => string;
}

export function readNpmCmdShimTarget(input: NpmCmdShimRead): NpmCmdShimTarget | null {
  const { shimPath } = input;
  const readFile = input.readFile ?? readUtf8;
  let text: string;
  try {
    text = readFile(shimPath);
  } catch {
    return null;
  }
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (!HEAD.every((line, index) => lines[index]?.toLowerCase() === line)) {
    return null;
  }
  const rest = lines.slice(HEAD.length);
  const folder = path.win32.dirname(shimPath);

  if (rest.length === 1) {
    const run = BINARY_RUN.exec(rest[0]);
    if (!run) return null;
    const target = path.win32.join(folder, run[1]);
    return PROGRAM_EXTENSIONS.has(path.win32.extname(target).toLowerCase())
      ? { kind: "executable", path: target }
      : null;
  }

  if (
    rest.length !== NODE_BRANCH.length + 1 ||
    !NODE_BRANCH.every((line, index) => rest[index].toLowerCase() === line)
  ) {
    return null;
  }
  const run = NODE_RUN.exec(rest[NODE_BRANCH.length]);
  if (!run) return null;
  const nodeArgs = run[1].trim() === "" ? [] : run[1].trim().split(/\s+/);
  if (nodeArgs.some((arg) => /["%^&|<>]/.test(arg))) {
    return null;
  }
  return {
    kind: "node-script",
    script: path.win32.join(folder, run[2]),
    nodeArgs,
    bundledNode: path.win32.join(folder, "node.exe"),
  };
}

function readUtf8(filePath: string): string {
  return readFileSync(filePath, "utf8");
}
