import { describe, expect, it } from "vitest";

import { readNpmCmdShimTarget } from "./woowtech-npm-cmd-shim.js";

// Written by npm's cmd-shim 7.0.0 (npm 10.9), for a script with a shebang and for a binary.
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

function nodeShim(prog: string, args: string, target: string): string {
  return [
    ...HEAD,
    "",
    `IF EXIST "%dp0%\\${prog}.exe" (`,
    `  SET "_prog=%dp0%\\${prog}.exe"`,
    ") ELSE (",
    `  SET "_prog=${prog}"`,
    "  SET PATHEXT=%PATHEXT:;.JS;=;%",
    ")",
    "",
    `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%" ${args} "%dp0%\\${target}" %*`,
    "",
  ].join("\r\n");
}

function binaryShim(target: string): string {
  return [...HEAD, `"%dp0%\\${target}"   %*`, ""].join("\r\n");
}

const NPM = "C:\\Users\\a\\AppData\\Roaming\\npm";

function read(content: string): (path: string) => string {
  return () => content;
}

describe("readNpmCmdShimTarget", () => {
  it("finds the script a node shim runs, and the node.exe it prefers", () => {
    const shim = nodeShim("node", "", "node_modules\\@anthropic-ai\\claude-code\\cli.js");
    expect(readNpmCmdShimTarget({ shimPath: `${NPM}\\claude.cmd`, readFile: read(shim) })).toEqual({
      kind: "node-script",
      script: `${NPM}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`,
      nodeArgs: [],
      bundledNode: `${NPM}\\node.exe`,
    });
  });

  it("keeps the node options from the script's shebang", () => {
    const shim = nodeShim("node", "--no-warnings", "..\\pkg\\bin\\args.js");
    expect(
      readNpmCmdShimTarget({ shimPath: "C:\\p\\bin\\args.cmd", readFile: read(shim) }),
    ).toEqual({
      kind: "node-script",
      script: "C:\\p\\pkg\\bin\\args.js",
      nodeArgs: ["--no-warnings"],
      bundledNode: "C:\\p\\bin\\node.exe",
    });
  });

  it("finds the program a binary shim runs", () => {
    const shim = binaryShim("node_modules\\@openai\\codex\\bin\\codex.exe");
    expect(readNpmCmdShimTarget({ shimPath: `${NPM}\\codex.cmd`, readFile: read(shim) })).toEqual({
      kind: "executable",
      path: `${NPM}\\node_modules\\@openai\\codex\\bin\\codex.exe`,
    });
  });

  it("leaves shims for other interpreters, env settings and non-programs to cmd.exe", () => {
    const shims = [
      nodeShim("bash", "", "..\\pkg\\bin\\run.sh"),
      // `#!/usr/bin/env -S NODE_OPTIONS=… node`, as cmd-shim 7 writes it.
      nodeShim("NODE_OPTIONS=--max-old-space-size=4096", "node", "..\\pkg\\bin\\vars.js"),
      binaryShim("..\\pkg\\bin\\tool.ps1"),
      nodeShim("node", "", "cli.js").replace("SETLOCAL", "SETLOCAL\r\nSET NODE_PATH=C:\\x"),
    ];
    for (const shim of shims) {
      expect(
        readNpmCmdShimTarget({ shimPath: "C:\\p\\bin\\x.cmd", readFile: read(shim) }),
      ).toBeNull();
    }
  });

  it("leaves hand-written batch files and unreadable files alone", () => {
    const handWritten = ["@echo off", 'call "%~dp0\\real.cmd" %*', ""].join("\r\n");
    expect(
      readNpmCmdShimTarget({ shimPath: "C:\\p\\tool.cmd", readFile: read(handWritten) }),
    ).toBeNull();
    expect(
      readNpmCmdShimTarget({
        shimPath: "C:\\p\\tool.cmd",
        readFile: () => {
          throw new Error("EACCES");
        },
      }),
    ).toBeNull();
  });
});
