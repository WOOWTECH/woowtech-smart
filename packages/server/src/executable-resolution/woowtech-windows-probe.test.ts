import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { isPlatform } from "../test-utils/platform.js";
import { createWindowsProbe } from "./woowtech-windows-probe.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function script(body: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "woowtech-probe-"));
  tempDirs.push(dir);
  const file = path.join(dir, "tool");
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

// The probe's rules are the same everywhere; POSIX scripts stand in for Windows programs.
describe.skipIf(isPlatform("win32"))("the Windows --version probe", () => {
  const probe = createWindowsProbe({ minTimeoutMs: 2_000 });

  it("counts a program that answers, or exits with a code, as found", async () => {
    await expect(probe(script('echo "2.1.283 (Claude Code)"'), 1)).resolves.toBe(true);
    await expect(probe(script("exit 3"), 1)).resolves.toBe(true);
  });

  it("does not count a program that never answers", async () => {
    await expect(probe(script("exec sleep 30"), 1)).resolves.toBe(false);
  });

  it("does not count a file that cannot start", async () => {
    await expect(probe(path.join(os.tmpdir(), "woowtech-no-such-tool"), 1)).resolves.toBe(false);
  });
});

function windowsFile(name: string, contents: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "woowtech-probe-"));
  tempDirs.push(dir);
  const file = path.join(dir, name);
  writeFileSync(file, contents);
  return file;
}

// The same rules on real Windows, where command scripts run through cmd.exe.
describe.runIf(isPlatform("win32"))("the --version probe on real Windows", () => {
  const probe = createWindowsProbe({ minTimeoutMs: 2_000 });

  it("counts a program that answers, or exits with a code, as found", async () => {
    await expect(probe(process.execPath, 1)).resolves.toBe(true);
    const answers = windowsFile("answers.cmd", "@echo 2.1.283 (Claude Code)\r\n");
    await expect(probe(answers, 1)).resolves.toBe(true);
    const fails = windowsFile("fails.cmd", "@exit /b 3\r\n");
    await expect(probe(fails, 1)).resolves.toBe(true);
  });

  it("does not count a command script that never answers", async () => {
    const hangs = windowsFile("hangs.cmd", "@ping -n 6 127.0.0.1 >nul 2>&1\r\n");
    await expect(probe(hangs, 1)).resolves.toBe(false);
  });

  it("does not count a file that cannot start", async () => {
    await expect(probe(windowsFile("broken.exe", "not a program"), 1)).resolves.toBe(false);
    await expect(probe(path.join(os.tmpdir(), "woowtech-no-such-tool.exe"), 1)).resolves.toBe(
      false,
    );
  });
});
