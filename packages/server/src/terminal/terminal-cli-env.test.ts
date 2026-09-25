import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTerminalEnvironment } from "./terminal.js";

// The woowtech smart desktop app starts its daemon with PASEO_CLI set to the
// bundle's woowtech-smart shim, which sits beside upstream's bin/paseo. Terminal
// hooks keep upstream's exact command text, so they must reach our CLI through
// PASEO_HOOK_CLI, and OpenCode's plugin through a bare `paseo` on PATH.
describe("terminals of a woowtech smart desktop daemon", () => {
  const savedCli = process.env.PASEO_CLI;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "woowtech-terminal-cli-"));
  });

  afterEach(() => {
    if (savedCli === undefined) delete process.env.PASEO_CLI;
    else process.env.PASEO_CLI = savedCli;
    rmSync(root, { recursive: true, force: true });
  });

  it("run agent hooks with the app's bundled CLI and find it first on PATH", () => {
    const bundledBin = join(root, "woowtech smart.app", "Contents", "Resources", "bin");
    mkdirSync(bundledBin, { recursive: true });
    for (const name of ["woowtech-smart", "paseo"]) {
      writeFileSync(join(bundledBin, name), "#!/bin/sh\n");
    }
    process.env.PASEO_CLI = join(bundledBin, "woowtech-smart");

    const env = buildTerminalEnvironment({ shell: "/bin/bash", env: { PATH: "/usr/bin:/bin" } });

    expect(env.PASEO_HOOK_CLI).toBe(join(bundledBin, "woowtech-smart"));
    expect(env.PATH?.split(delimiter)[0]).toBe(bundledBin);
  });
});
