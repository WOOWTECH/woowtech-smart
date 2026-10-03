import { describe, expect, it } from "vitest";

import {
  renderWindowsCliTrampoline,
  WINDOWS_CLI_MARKER,
  windowsShimPathExpression,
} from "./woowtech-windows-cli-shim.js";

// A Traditional Chinese user name, the case cmd.exe misreads in code page 950.
const env = {
  USERPROFILE: "C:\\Users\\王小明",
  LOCALAPPDATA: "C:\\Users\\王小明\\AppData\\Local",
  APPDATA: "C:\\Users\\王小明\\AppData\\Roaming",
  PROGRAMFILES: "C:\\Program Files",
  "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
};
const INSTALLED =
  "C:\\Users\\王小明\\AppData\\Local\\Programs\\woowtech smart\\resources\\bin\\woowtech-smart.cmd";

describe("windowsShimPathExpression", () => {
  it("expresses a per-user install through %LOCALAPPDATA%", () => {
    expect(windowsShimPathExpression({ shimPath: INSTALLED, env })).toBe(
      "%LOCALAPPDATA%\\Programs\\woowtech smart\\resources\\bin\\woowtech-smart.cmd",
    );
  });

  it("prefers the most specific root and compares case-insensitively", () => {
    expect(
      windowsShimPathExpression({
        shimPath: "c:\\users\\王小明\\appdata\\roaming\\x\\woowtech-smart.cmd",
        env,
      }),
    ).toBe("%APPDATA%\\x\\woowtech-smart.cmd");
    expect(
      windowsShimPathExpression({ shimPath: "C:\\Users\\王小明\\x\\woowtech-smart.cmd", env }),
    ).toBe("%USERPROFILE%\\x\\woowtech-smart.cmd");
    expect(
      windowsShimPathExpression({
        shimPath: "C:\\Program Files (x86)\\woowtech smart\\resources\\bin\\woowtech-smart.cmd",
        env,
      }),
    ).toBe("%PROGRAMFILES(X86)%\\woowtech smart\\resources\\bin\\woowtech-smart.cmd");
  });

  it("leaves a path outside every root, or under a look-alike sibling, as it is", () => {
    for (const shimPath of [
      "D:\\Tools\\woowtech smart\\resources\\bin\\woowtech-smart.cmd",
      "C:\\Users\\王小明2\\x\\woowtech-smart.cmd",
    ]) {
      expect(windowsShimPathExpression({ shimPath, env })).toBe(shimPath);
    }
  });
});

describe("renderWindowsCliTrampoline", () => {
  it("writes an ASCII, CRLF trampoline that the uninstaller recognizes", () => {
    const content = renderWindowsCliTrampoline({ shimPath: INSTALLED, env });
    expect([...content].every((char) => char.charCodeAt(0) < 128)).toBe(true);
    expect(content.endsWith("\r\n")).toBe(true);
    expect(content.replace(/\r\n/g, "")).not.toContain("\n");
    expect(content.split("\r\n")).toEqual([
      "@echo off",
      `${WINDOWS_CLI_MARKER}: written by woowtech smart, removed by its uninstaller`,
      "setlocal",
      'set "BUNDLED_CLI=%LOCALAPPDATA%\\Programs\\woowtech smart\\resources\\bin\\woowtech-smart.cmd"',
      'if not exist "%BUNDLED_CLI%" (',
      '  echo woowtech smart CLI not found at "%BUNDLED_CLI%". Is woowtech smart installed? 1>&2',
      "  exit /b 1",
      ")",
      '"%BUNDLED_CLI%" %*',
      "",
    ]);
  });

  it("keeps an ASCII path outside every root free of the code-page switch", () => {
    const content = renderWindowsCliTrampoline({
      shimPath: "D:\\Tools\\woowtech smart\\resources\\bin\\woowtech-smart.cmd",
      env,
    });
    expect(content).not.toContain("chcp");
    expect(content).toContain(
      'set "BUNDLED_CLI=D:\\Tools\\woowtech smart\\resources\\bin\\woowtech-smart.cmd"',
    );
  });

  it("reads a non-ASCII path outside every root as UTF-8, and only that line", () => {
    const content = renderWindowsCliTrampoline({
      shimPath: "D:\\軟體\\woowtech smart\\resources\\bin\\woowtech-smart.cmd",
      env,
    });
    const lines = content.split("\r\n");
    expect(lines.slice(0, 9)).toEqual([
      "@echo off",
      `${WINDOWS_CLI_MARKER}: written by woowtech smart, removed by its uninstaller`,
      "setlocal",
      `for /f "tokens=2 delims=:." %%c in ('chcp') do set "WOOWTECH_CODEPAGE=%%c"`,
      ">nul chcp 65001",
      'set "BUNDLED_CLI=D:\\軟體\\woowtech smart\\resources\\bin\\woowtech-smart.cmd"',
      ">nul chcp %WOOWTECH_CODEPAGE%",
      'set "WOOWTECH_CODEPAGE="',
      'if not exist "%BUNDLED_CLI%" (',
    ]);
    const nonAscii = (line: string) => [...line].some((char) => char.charCodeAt(0) > 127);
    expect(lines.filter(nonAscii)).toEqual([lines[5]]);
  });
});
