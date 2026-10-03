import { describe, expect, it, vi } from "vitest";

import { resolveDefaultTerminalShell } from "./terminal.js";
import {
  prepareWoowtechDefaultShell,
  resolveWoowtechDefaultShell,
} from "./woowtech-default-shell.js";

const WINDOWS_ENV = {
  ComSpec: "C:\\Windows\\System32\\cmd.exe",
  SystemRoot: "C:\\Windows",
  ProgramFiles: "C:\\Program Files",
  LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local",
  Path: "C:\\Windows\\System32",
};
const POWERSHELL = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const PWSH_7 = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
const PWSH_STORE = "C:\\Users\\a\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe";

function files(...paths: string[]): (path: string) => boolean {
  const present = new Set(paths.map((path) => path.toLowerCase()));
  return (path) => present.has(path.toLowerCase());
}

describe("resolveWoowtechDefaultShell on Windows", () => {
  it("opens PowerShell 7 when it is installed, without the banner", () => {
    expect(
      resolveWoowtechDefaultShell({
        platform: "win32",
        upstreamDefault: resolveDefaultTerminalShell,
        env: WINDOWS_ENV,
        isFile: files(PWSH_7, POWERSHELL),
      }),
    ).toEqual({ command: PWSH_7, args: ["-NoLogo"] });
  });

  it("finds pwsh on PATH first, then the Store copy", () => {
    const onPath = "D:\\tools\\pwsh\\pwsh.exe";
    expect(
      resolveWoowtechDefaultShell({
        platform: "win32",
        upstreamDefault: resolveDefaultTerminalShell,
        env: { ...WINDOWS_ENV, Path: "D:\\tools\\pwsh" },
        isFile: files(onPath, PWSH_7, POWERSHELL),
      }),
    ).toEqual({ command: onPath, args: ["-NoLogo"] });
    expect(
      resolveWoowtechDefaultShell({
        platform: "win32",
        upstreamDefault: resolveDefaultTerminalShell,
        env: WINDOWS_ENV,
        isFile: files(PWSH_STORE, POWERSHELL),
      }),
    ).toEqual({ command: PWSH_STORE, args: ["-NoLogo"] });
  });

  it("falls back to Windows PowerShell, then to cmd.exe", () => {
    expect(
      resolveWoowtechDefaultShell({
        platform: "win32",
        upstreamDefault: resolveDefaultTerminalShell,
        env: WINDOWS_ENV,
        isFile: files(POWERSHELL),
      }),
    ).toEqual({ command: POWERSHELL, args: ["-NoLogo"] });
    expect(
      resolveWoowtechDefaultShell({
        platform: "win32",
        upstreamDefault: resolveDefaultTerminalShell,
        env: WINDOWS_ENV,
        isFile: files(),
      }),
    ).toEqual({ command: "C:\\Windows\\System32\\cmd.exe", args: [] });
  });

  it("lets WOOWTECH_TERMINAL_SHELL choose, like $SHELL on the Mac", () => {
    expect(
      resolveWoowtechDefaultShell({
        platform: "win32",
        upstreamDefault: resolveDefaultTerminalShell,
        env: { ...WINDOWS_ENV, WOOWTECH_TERMINAL_SHELL: "cmd.exe" },
        isFile: files(PWSH_7, POWERSHELL),
      }),
    ).toEqual({ command: "cmd.exe", args: [] });
  });
});

describe("resolveWoowtechDefaultShell elsewhere", () => {
  it("keeps the user's $SHELL", () => {
    expect(
      resolveWoowtechDefaultShell({
        platform: "darwin",
        upstreamDefault: resolveDefaultTerminalShell,
        env: { SHELL: "/bin/zsh", WOOWTECH_TERMINAL_SHELL: "/bin/bash" },
        isFile: files(),
      }),
    ).toEqual({ command: "/bin/zsh", args: [] });
  });
});

describe("prepareWoowtechDefaultShell", () => {
  it("uses a shell the caller chose as is", async () => {
    const refresh = vi.fn(async () => {});
    await expect(
      prepareWoowtechDefaultShell({
        shell: "/bin/bash",
        platform: "win32",
        upstreamDefault: resolveDefaultTerminalShell,
        refresher: { refresh, pathVersion: () => 0 },
      }),
    ).resolves.toEqual({ command: "/bin/bash", args: [] });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes PATH first on Windows, so a new terminal sees newly installed tools", async () => {
    const refresh = vi.fn(async () => {});
    await prepareWoowtechDefaultShell({
      platform: "win32",
      upstreamDefault: resolveDefaultTerminalShell,
      env: WINDOWS_ENV,
      isFile: files(POWERSHELL),
      refresher: { refresh, pathVersion: () => 0 },
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not wait more than two seconds for the refresh", async () => {
    vi.useFakeTimers();
    try {
      const pending = prepareWoowtechDefaultShell({
        platform: "win32",
        upstreamDefault: resolveDefaultTerminalShell,
        env: WINDOWS_ENV,
        isFile: files(POWERSHELL),
        refresher: { refresh: () => new Promise(() => {}), pathVersion: () => 0 },
      });
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(pending).resolves.toEqual({ command: POWERSHELL, args: ["-NoLogo"] });
    } finally {
      vi.useRealTimers();
    }
  });
});
