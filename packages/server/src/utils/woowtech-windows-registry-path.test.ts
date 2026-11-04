import { describe, expect, it, vi } from "vitest";

import {
  createWindowsPathRefresher,
  findWithWindowsPathRefresh,
  mergeRegistryPath,
  readRegistryPaths,
  type RegistryPaths,
} from "./woowtech-windows-registry-path.js";

describe("mergeRegistryPath", () => {
  it("appends machine, then user entries the process does not have yet", () => {
    expect(
      mergeRegistryPath({
        current: "C:\\Windows\\System32;C:\\Program Files\\Git\\cmd",
        fresh: {
          machine: "C:\\Windows\\System32;C:\\Program Files\\GitHub CLI",
          user: "C:\\Users\\a\\AppData\\Roaming\\npm;C:\\Users\\a\\.local\\bin",
        },
      }),
    ).toEqual({
      path: "C:\\Windows\\System32;C:\\Program Files\\Git\\cmd;C:\\Program Files\\GitHub CLI;C:\\Users\\a\\AppData\\Roaming\\npm;C:\\Users\\a\\.local\\bin",
      added: [
        "C:\\Program Files\\GitHub CLI",
        "C:\\Users\\a\\AppData\\Roaming\\npm",
        "C:\\Users\\a\\.local\\bin",
      ],
    });
  });

  it("treats case, quotes and a trailing backslash as the same folder, and never reorders", () => {
    expect(
      mergeRegistryPath({
        current: '"C:\\Program Files\\Git\\cmd";c:\\tools\\;',
        fresh: { machine: "C:\\TOOLS;C:\\Program Files\\Git\\cmd\\", user: null },
      }),
    ).toEqual({ path: '"C:\\Program Files\\Git\\cmd";c:\\tools\\;', added: [] });
  });

  it("skips entries with a variable it cannot expand, and empty ones", () => {
    expect(
      mergeRegistryPath({
        current: "",
        fresh: { machine: "%JAVA_HOME%\\bin;;C:\\x", user: " ; C:\\y " },
      }),
    ).toEqual({ path: "C:\\x;C:\\y", added: ["C:\\x", "C:\\y"] });
  });
});

describe("readRegistryPaths", () => {
  it("asks Windows PowerShell, by its full path and hidden, for both saved Path values", async () => {
    const execFile = vi.fn(async (_file: string, _args: string[], _options: object) => ({
      stdout: '{"machine":"C:\\\\Windows","user":null}\r\n',
      stderr: "",
    }));
    await expect(readRegistryPaths({ execFile, systemRoot: "D:\\Win" })).resolves.toEqual({
      machine: "C:\\Windows",
      user: null,
    });
    const [file, args, options] = execFile.mock.calls[0];
    expect(file).toBe("D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(args.slice(0, 4)).toEqual([
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
    ]);
    const script = Buffer.from(args[4], "base64").toString("utf16le");
    expect(script).toContain("[Environment]::GetEnvironmentVariable('Path', 'Machine')");
    expect(script).toContain("[Environment]::GetEnvironmentVariable('Path', 'User')");
    expect(script).toContain("UTF8Encoding");
    expect(options).toMatchObject({ windowsHide: true, timeout: 5000 });
  });
});

function harness(fresh: RegistryPaths | Error) {
  let time = 0;
  const log = vi.fn();
  const read = vi.fn(async () => {
    if (fresh instanceof Error) throw fresh;
    return fresh;
  });
  const env: Record<string, string | undefined> = { Path: "C:\\Windows" };
  const refresher = createWindowsPathRefresher({
    platform: "win32",
    env,
    read,
    now: () => time,
    minIntervalMs: 10_000,
    log,
  });
  return {
    env,
    read,
    log,
    refresher,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe("createWindowsPathRefresher", () => {
  it("adds new folders to the process PATH under its own key", async () => {
    const h = harness({ machine: "C:\\Windows;C:\\tools", user: null });
    const before = h.refresher.pathVersion();
    await h.refresher.refresh();
    expect(h.env).toEqual({ Path: "C:\\Windows;C:\\tools" });
    expect(h.refresher.pathVersion()).toBe(before + 1);
    expect(h.log).toHaveBeenCalledWith("[woowtech] PATH refreshed from registry", {
      added: ["C:\\tools"],
    });
  });

  it("shares one read between concurrent misses and reads at most every 10 s", async () => {
    const h = harness({ machine: null, user: "C:\\new" });
    await Promise.all([h.refresher.refresh(), h.refresher.refresh()]);
    expect(h.read).toHaveBeenCalledTimes(1);
    h.advance(9_999);
    await h.refresher.refresh();
    expect(h.read).toHaveBeenCalledTimes(1);
    h.advance(1);
    await h.refresher.refresh();
    expect(h.read).toHaveBeenCalledTimes(2);
  });

  it("keeps PATH and logs once when the registry cannot be read", async () => {
    const h = harness(new Error("powershell.exe blocked"));
    await h.refresher.refresh();
    h.advance(10_000);
    await h.refresher.refresh();
    expect(h.env).toEqual({ Path: "C:\\Windows" });
    expect(h.log).toHaveBeenCalledTimes(1);
    expect(h.log).toHaveBeenCalledWith("[woowtech] PATH refresh failed", {
      error: "Error: powershell.exe blocked",
    });
  });

  it("does nothing outside Windows", async () => {
    const read = vi.fn();
    const refresher = createWindowsPathRefresher({
      platform: "darwin",
      env: {},
      read,
      now: () => 0,
      minIntervalMs: 0,
    });
    await refresher.refresh();
    expect(read).not.toHaveBeenCalled();
  });
});

describe("findWithWindowsPathRefresh", () => {
  it("does not touch the registry when the lookup finds the program", async () => {
    const h = harness({ machine: "C:\\tools", user: null });
    const lookup = vi.fn(async () => "C:\\Windows\\gh.exe");
    await expect(findWithWindowsPathRefresh({ lookup, refresher: h.refresher })).resolves.toBe(
      "C:\\Windows\\gh.exe",
    );
    expect(h.read).not.toHaveBeenCalled();
  });

  it("looks again after a refresh that changed PATH", async () => {
    const h = harness({ machine: "C:\\tools", user: null });
    const lookup = vi.fn(async () =>
      h.env.Path?.includes("C:\\tools") ? "C:\\tools\\gh.exe" : null,
    );
    await expect(findWithWindowsPathRefresh({ lookup, refresher: h.refresher })).resolves.toBe(
      "C:\\tools\\gh.exe",
    );
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("gives up after one lookup when PATH did not change", async () => {
    const h = harness({ machine: "C:\\Windows", user: null });
    const lookup = vi.fn(async () => null);
    await expect(
      findWithWindowsPathRefresh({ lookup, refresher: h.refresher }),
    ).resolves.toBeNull();
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});
