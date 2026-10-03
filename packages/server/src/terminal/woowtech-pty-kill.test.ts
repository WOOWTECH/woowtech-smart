import { describe, expect, it } from "vitest";
import { createPtyKiller, woowtechConptyOptions } from "./woowtech-pty-kill.js";

function fakePty(pid = 4321, throwOnKill = false) {
  const calls: Array<string | undefined> = [];
  return {
    calls,
    pty: {
      pid,
      kill: (signal?: string) => {
        calls.push(signal);
        if (throwOnKill) throw new Error("already exited");
      },
    },
  };
}

describe("pty killer", () => {
  it("kills a Windows pty once and escalates to the process tree", async () => {
    const f = fakePty();
    const trees: number[] = [];
    const killer = createPtyKiller({
      pty: f.pty,
      platform: "win32",
      killTree: async (pid) => {
        trees.push(pid);
        return null;
      },
    });
    killer.kill();
    killer.kill("SIGKILL");
    killer.kill();
    killer.kill("SIGKILL");
    expect(f.calls).toEqual([undefined]);
    expect(trees).toEqual([4321]);
  });

  it("does not retry a Windows kill that threw", () => {
    const f = fakePty(4321, true);
    const killer = createPtyKiller({ pty: f.pty, platform: "win32", killTree: async () => null });
    expect(() => killer.kill()).toThrow("already exited");
    killer.kill();
    expect(f.calls).toEqual([undefined]);
  });

  it("never tree-kills a pty without a process id", () => {
    const f = fakePty(0);
    const trees: number[] = [];
    const killer = createPtyKiller({
      pty: f.pty,
      platform: "win32",
      killTree: async (pid) => {
        trees.push(pid);
        return null;
      },
    });
    killer.kill();
    killer.kill("SIGKILL");
    expect(trees).toEqual([]);
  });

  it("passes signals through on macOS and Linux", () => {
    for (const platform of ["darwin", "linux"] as const) {
      const f = fakePty();
      const killer = createPtyKiller({ pty: f.pty, platform });
      killer.kill("SIGTERM");
      killer.kill("SIGKILL");
      killer.kill();
      expect(f.calls).toEqual(["SIGTERM", "SIGKILL", undefined]);
    }
  });
});

describe("bundled ConPTY", () => {
  it("is used only on Windows when asked for", () => {
    expect(woowtechConptyOptions("win32", { WOOWTECH_CONPTY_DLL: "1" })).toEqual({
      useConptyDll: true,
    });
    expect(woowtechConptyOptions("win32", {})).toEqual({});
    expect(woowtechConptyOptions("darwin", { WOOWTECH_CONPTY_DLL: "1" })).toEqual({});
  });
});
