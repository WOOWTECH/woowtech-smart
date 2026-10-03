import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { windowsExecutableResolution } from "./windows.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function wingetPackage(name: string, files: string[]): string {
  const localAppData = mkdtempSync(path.join(os.tmpdir(), "woowtech-winget-"));
  tempDirs.push(localAppData);
  const packageDir = path.join(localAppData, "Microsoft", "WinGet", "Packages", name);
  mkdirSync(packageDir, { recursive: true });
  for (const file of files) {
    writeFileSync(path.join(packageDir, file), "");
  }
  return localAppData;
}

describe("WinGet package folders", () => {
  it("finds Codex under the file name its WinGet package uses", async () => {
    const localAppData = wingetPackage("OpenAI.Codex_Microsoft.Winget.Source_8wekyb3d8bbwe", [
      "codex-x86_64-pc-windows-msvc.exe",
      "codex-command-runner.exe",
    ]);
    const probeExecutable = vi.fn(async () => true);

    const found = await windowsExecutableResolution.find("codex", {
      enumeratePathCandidates: async () => [],
      probeExecutable,
      exists: existsSync,
      localAppData,
      probeTimeoutMs: 1,
    });

    expect(found).toBe(
      path.join(
        localAppData,
        "Microsoft",
        "WinGet",
        "Packages",
        "OpenAI.Codex_Microsoft.Winget.Source_8wekyb3d8bbwe",
        "codex-x86_64-pc-windows-msvc.exe",
      ),
    );
    expect(probeExecutable).toHaveBeenCalledTimes(1);
  });

  it("still prefers the plain command name in the same folder", async () => {
    const localAppData = wingetPackage("Anthropic.ClaudeCode_abc", [
      "claude-x86_64-pc-windows-msvc.exe",
      "claude.exe",
    ]);

    const found = await windowsExecutableResolution.find("claude", {
      enumeratePathCandidates: async () => [],
      probeExecutable: async () => true,
      exists: existsSync,
      localAppData,
      probeTimeoutMs: 1,
    });

    expect(found).toBe(
      path.join(
        localAppData,
        "Microsoft",
        "WinGet",
        "Packages",
        "Anthropic.ClaudeCode_abc",
        "claude.exe",
      ),
    );
  });
});
