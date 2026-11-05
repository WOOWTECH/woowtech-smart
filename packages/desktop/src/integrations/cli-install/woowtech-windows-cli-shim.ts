// woowtech smart: the Windows trampoline Settings > Install CLI writes to
// %USERPROFILE%\.local\bin\woowtech-smart.cmd (woowtech/README.md §31, plan G16; a port of
// upstream PR #4696). cmd.exe reads batch files in the console's OEM code page (950 on Traditional
// Chinese Windows), so a Chinese user name in the baked-in install path turns into mojibake and the
// trampoline never finds the bundled CLI. The path goes through the variable it lives under
// (%LOCALAPPDATA% and so on), which cmd.exe expands in memory, so the file stays ASCII. A
// non-ASCII custom folder outside every root is written as UTF-8 and read under code page 65001
// for that one line. Fork changes to #4696: the marker line build/installer.nsh looks for,
// setlocal, a quoted path in the message (a ")" in it would end the block), and a jump to the
// bundled CLI without CALL, which would expand % and carets in the arguments a second time.
// The names come from the brand this tree builds, so another brand's release tree writes its
// own; build/installer.nsh holds woowtech's marker, the one brand built for Windows so far.
import { CLI_COMMAND } from "@getpaseo/protocol/brand-cli";
import { PRODUCT_NAME } from "@getpaseo/protocol/brand-name";

export const WINDOWS_CLI_MARKER = `rem ${CLI_COMMAND} CLI trampoline`;
const MARKER_LINE = `${WINDOWS_CLI_MARKER}: written by ${PRODUCT_NAME}, removed by its uninstaller`;

// Longest first, so the most specific root wins: %LOCALAPPDATA% and %APPDATA% sit under
// %USERPROFILE%.
const ROOT_VARIABLES = [
  "LOCALAPPDATA",
  "APPDATA",
  "PROGRAMFILES(X86)",
  "PROGRAMFILES",
  "USERPROFILE",
] as const;

export interface WindowsShimPath {
  shimPath: string;
  env: NodeJS.ProcessEnv;
}

function normalizeWindowsPath(value: string): string {
  return value.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

function readEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

/** Rewrites the leading root of the shim path as %VARIABLE% when it lies under one. */
export function windowsShimPathExpression(input: WindowsShimPath): string {
  const normalizedShim = normalizeWindowsPath(input.shimPath);
  const roots = ROOT_VARIABLES.flatMap((name) => {
    const value = readEnv(input.env, name);
    return value ? [{ name, value, normalized: normalizeWindowsPath(value) }] : [];
  }).sort((a, b) => b.normalized.length - a.normalized.length);
  for (const root of roots) {
    if (normalizedShim.startsWith(`${root.normalized}\\`)) {
      const rest = input.shimPath
        .slice(root.value.replace(/[\\/]+$/, "").length)
        .replace(/^[\\/]+/, "");
      return `%${root.name}%\\${rest.replace(/\//g, "\\")}`;
    }
  }
  return input.shimPath;
}

export interface WindowsTrampolineInput {
  shimPath: string;
  env?: NodeJS.ProcessEnv;
}

function isAscii(text: string): boolean {
  return [...text].every((char) => char.charCodeAt(0) < 128);
}

/** The whole trampoline, CRLF line ends; ASCII unless a custom folder forces the UTF-8 line. */
export function renderWindowsCliTrampoline(input: WindowsTrampolineInput): string {
  const bundled = windowsShimPathExpression({
    shimPath: input.shimPath,
    env: input.env ?? process.env,
  });
  const setBundled = `set "BUNDLED_CLI=${bundled}"`;
  return [
    "@echo off",
    MARKER_LINE,
    "setlocal",
    ...(isAscii(bundled)
      ? [setBundled]
      : [
          `for /f "tokens=2 delims=:." %%c in ('chcp') do set "WOOWTECH_CODEPAGE=%%c"`,
          ">nul chcp 65001",
          setBundled,
          ">nul chcp %WOOWTECH_CODEPAGE%",
          'set "WOOWTECH_CODEPAGE="',
        ]),
    'if not exist "%BUNDLED_CLI%" (',
    `  echo ${PRODUCT_NAME} CLI not found at "%BUNDLED_CLI%". Is ${PRODUCT_NAME} installed? 1>&2`,
    "  exit /b 1",
    ")",
    '"%BUNDLED_CLI%" %*',
    "",
  ].join("\r\n");
}
