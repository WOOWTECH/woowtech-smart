import { describe, expect, it } from "vitest";
import {
  killProcessTree,
  windowsTaskkillPath,
  type ProcessTreeKillDeps,
} from "./woowtech-process-tree-kill.js";

function deps(platform: NodeJS.Platform, failWith: Error | null = null) {
  const execCalls: Array<{ file: string; args: string[]; windowsHide: boolean }> = [];
  const treeKillCalls: Array<{ pid: number; signal: string }> = [];
  const value: ProcessTreeKillDeps = {
    platform,
    systemRoot: "D:\\Win",
    execFile: (file, args, options, callback) => {
      execCalls.push({ file, args, windowsHide: options.windowsHide });
      callback(failWith);
    },
    treeKill: (pid, signal, callback) => {
      treeKillCalls.push({ pid, signal });
      callback(failWith ?? undefined);
    },
  };
  return { value, execCalls, treeKillCalls };
}

describe("killProcessTree", () => {
  it("runs System32 taskkill hidden on Windows instead of through cmd.exe", async () => {
    const d = deps("win32");
    await expect(killProcessTree(4321, "SIGTERM", d.value)).resolves.toBeNull();
    expect(d.execCalls).toEqual([
      {
        file: "D:\\Win\\System32\\taskkill.exe",
        args: ["/pid", "4321", "/T", "/F"],
        windowsHide: true,
      },
    ]);
    expect(d.treeKillCalls).toEqual([]);
  });

  it("keeps tree-kill on macOS and Linux", async () => {
    for (const platform of ["darwin", "linux"] as const) {
      const d = deps(platform);
      await expect(killProcessTree(7, "SIGKILL", d.value)).resolves.toBeNull();
      expect(d.treeKillCalls).toEqual([{ pid: 7, signal: "SIGKILL" }]);
      expect(d.execCalls).toEqual([]);
    }
  });

  it("reports failures without rejecting, as tree-kill's callback does", async () => {
    const failure = new Error("process not found");
    await expect(killProcessTree(1, "SIGTERM", deps("win32", failure).value)).resolves.toBe(
      failure,
    );
    await expect(killProcessTree(1, "SIGTERM", deps("linux", failure).value)).resolves.toBe(
      failure,
    );
  });

  it("falls back to C:\\Windows when SystemRoot is missing", () => {
    expect(windowsTaskkillPath(undefined)).toBe("C:\\Windows\\System32\\taskkill.exe");
    expect(windowsTaskkillPath("")).toBe("C:\\Windows\\System32\\taskkill.exe");
  });
});
