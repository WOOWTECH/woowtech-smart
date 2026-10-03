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
