import { describe, expect, it } from "vitest";

import { WindowsCommandScriptArgumentError } from "./woowtech-cmd-escape.js";
import { planDirectWindowsSpawn, planWindowsSpawn } from "./woowtech-windows-spawn.js";

const NPM = "C:\\Users\\a\\AppData\\Roaming\\npm";
const ENV = {
  Path: `C:\\Program Files\\GitHub CLI;C:\\Program Files\\nodejs;${NPM};C:\\tools`,
  ComSpec: "C:\\Windows\\System32\\cmd.exe",
};
const HEAD = [
  "@ECHO off",
  "GOTO start",
  ":find_dp0",
  "SET dp0=%~dp0",
  "EXIT /b",
  ":start",
  "SETLOCAL",
  "CALL :find_dp0",
];
const CLAUDE_SHIM = [
  ...HEAD,
  "",
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ") ELSE (",
  '  SET "_prog=node"',
  "  SET PATHEXT=%PATHEXT:;.JS;=;%",
  ")",
  "",
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
  "",
].join("\r\n");
const CODEX_SHIM = [...HEAD, '"%dp0%\\node_modules\\@openai\\codex\\bin\\codex.exe"   %*', ""].join(
  "\r\n",
);

function machine(files: Record<string, string>) {
  const lower = new Map(Object.entries(files).map(([path, text]) => [path.toLowerCase(), text]));
  return {
    exists: (path: string) => lower.has(path.toLowerCase()),
    readFile: (path: string) => {
      const text = lower.get(path.toLowerCase());
      if (text === undefined) throw new Error(`ENOENT: ${path}`);
      return text;
    },
  };
}

const MACHINE = machine({
  "C:\\Program Files\\GitHub CLI\\gh.exe": "",
  "C:\\Program Files\\nodejs\\node.exe": "",
  [`${NPM}\\claude.cmd`]: CLAUDE_SHIM,
  [`${NPM}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`]: "",
  [`${NPM}\\codex.cmd`]: CODEX_SHIM,
  [`${NPM}\\node_modules\\@openai\\codex\\bin\\codex.exe`]: "",
  "C:\\tools\\build.cmd": "@echo off\r\nmsbuild %*\r\n",
});

describe("planWindowsSpawn", () => {
  it("starts a program found on PATH directly, so arguments arrive as written", () => {
    const query = 'query { repository(name: "x") {\n  id\n} } 100% & done';
    expect(
      planWindowsSpawn({
        command: "gh",
        args: ["api", "graphql", "-f", query],
        env: ENV,
        ...MACHINE,
      }),
    ).toEqual({
      via: "direct",
      command: "C:\\Program Files\\GitHub CLI\\gh.exe",
      args: ["api", "graphql", "-f", query],
      windowsVerbatimArguments: false,
    });
  });

  it("runs the node script behind an npm shim with node itself", () => {
    const prompt = 'line one\nline "two" & %PATH%';
    expect(
      planWindowsSpawn({ command: "claude", args: ["-p", prompt], env: ENV, ...MACHINE }),
    ).toEqual({
      via: "npm-shim",
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: [`${NPM}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`, "-p", prompt],
      windowsVerbatimArguments: false,
    });
  });

  it("prefers the node.exe that sits next to the shim, like the shim does", () => {
    const withBundledNode = machine({
      [`${NPM}\\claude.cmd`]: CLAUDE_SHIM,
      [`${NPM}\\node.exe`]: "",
      [`${NPM}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`]: "",
      "C:\\Program Files\\nodejs\\node.exe": "",
    });
    expect(
      planWindowsSpawn({ command: `${NPM}\\claude.cmd`, args: [], env: ENV, ...withBundledNode }),
    ).toMatchObject({ via: "npm-shim", command: `${NPM}\\node.exe` });
  });

  it("runs the program behind a binary npm shim", () => {
    expect(planWindowsSpawn({ command: "codex", args: ["exec"], env: ENV, ...MACHINE })).toEqual({
      via: "npm-shim",
      command: `${NPM}\\node_modules\\@openai\\codex\\bin\\codex.exe`,
      args: ["exec"],
      windowsVerbatimArguments: false,
    });
  });

  it("runs any other batch file through cmd.exe with escaped arguments", () => {
    expect(
      planWindowsSpawn({ command: "build", args: ["fix (wip)", "a&b"], env: ENV, ...MACHINE }),
    ).toEqual({
      via: "cmd-script",
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ['/d /v:off /s /c "C:\\tools\\build.cmd ^^^"fix^^^ ^^^(wip^^^)^^^" ^^^"a^^^&b^^^""'],
      windowsVerbatimArguments: true,
    });
  });

  it("refuses a line break for a batch file instead of cutting the argument (D18)", () => {
    expect(() =>
      planWindowsSpawn({ command: "build", args: ["a\nb"], env: ENV, ...MACHINE }),
    ).toThrow(WindowsCommandScriptArgumentError);
  });

  it("falls back to cmd.exe when an npm shim's node is nowhere to be found", () => {
    const noNode = machine({
      [`${NPM}\\claude.cmd`]: CLAUDE_SHIM,
      [`${NPM}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`]: "",
    });
    expect(planWindowsSpawn({ command: "claude", args: ["-v"], env: ENV, ...noNode })).toEqual({
      via: "cmd-script",
      command: "C:\\Windows\\System32\\cmd.exe",
      args: [`/d /v:off /s /c "${NPM}\\claude.cmd ^^^"-v^^^""`],
      windowsVerbatimArguments: true,
    });
  });

  it("leaves explicit shells, unknown programs and the escape hatch to upstream", () => {
    const upstream = { via: "upstream" };
    expect(
      planWindowsSpawn({ command: "gh", args: [], requestedShell: true, env: ENV, ...MACHINE }),
    ).toMatchObject(upstream);
    expect(
      planWindowsSpawn({ command: "gh", args: [], requestedShell: "pwsh", env: ENV, ...MACHINE }),
    ).toMatchObject(upstream);
    expect(planWindowsSpawn({ command: "missing", args: [], env: ENV, ...MACHINE })).toMatchObject(
      upstream,
    );
    expect(
      planWindowsSpawn({ command: "C:\\tools\\gone.exe", args: [], env: ENV, ...MACHINE }),
    ).toMatchObject(upstream);
    const relative = machine({ "tools\\build.cmd": "@echo off\r\n" });
    expect(
      planWindowsSpawn({ command: "tools\\build.cmd", args: [], env: ENV, ...relative }),
    ).toMatchObject(upstream);
    expect(
      planWindowsSpawn({
        command: "gh",
        args: [],
        env: { ...ENV, WOOWTECH_LEGACY_WINDOWS_SPAWN: "1" },
        ...MACHINE,
      }),
    ).toMatchObject(upstream);
  });
});

describe("planDirectWindowsSpawn", () => {
  it("plans only on Windows, and only when upstream's way does not apply", () => {
    const request = { command: "gh", args: ["pr", "list"], env: ENV, ...MACHINE };
    expect(planDirectWindowsSpawn({ ...request, platform: "darwin" })).toBeNull();
    expect(planDirectWindowsSpawn({ ...request, platform: "linux" })).toBeNull();
    expect(planDirectWindowsSpawn({ ...request, platform: "win32" })).toEqual({
      via: "direct",
      command: "C:\\Program Files\\GitHub CLI\\gh.exe",
      args: ["pr", "list"],
      windowsVerbatimArguments: false,
    });
    expect(
      planDirectWindowsSpawn({ ...request, requestedShell: true, platform: "win32" }),
    ).toBeNull();
  });
});
