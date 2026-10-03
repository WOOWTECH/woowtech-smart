import { describe, expect, it } from "vitest";
import {
  hasWindowsLaunchFlag,
  quitWhenAllWindowsClosed,
  registerAgentLinkProtocol,
  relaunchAction,
  trayHintText,
  trayLabels,
  windowsUninstallerPath,
} from "./woowtech-windows-shell.js";

describe("agent link protocol registration", () => {
  it("registers only from the packaged Windows app", () => {
    const calls: string[] = [];
    const set = (scheme: string) => {
      calls.push(scheme);
      return true;
    };
    expect(
      registerAgentLinkProtocol({
        platform: "win32",
        isPackaged: true,
        isInstalledCopy: () => true,
        scheme: "woowtech-smart",
        setAsDefaultProtocolClient: set,
      }),
    ).toBe(true);
    expect(calls).toEqual(["woowtech-smart"]);
    for (const input of [
      { platform: "win32" as const, isPackaged: false },
      { platform: "darwin" as const, isPackaged: true },
      { platform: "linux" as const, isPackaged: true },
    ]) {
      expect(
        registerAgentLinkProtocol({
          ...input,
          isInstalledCopy: () => true,
          scheme: "woowtech-smart",
          setAsDefaultProtocolClient: set,
        }),
      ).toBe(false);
    }
    expect(calls).toEqual(["woowtech-smart"]);
  });

  it("reports a failed or throwing registration as not registered", () => {
    const base = {
      platform: "win32" as const,
      isPackaged: true,
      isInstalledCopy: () => true,
      scheme: "woowtech-smart",
    };
    expect(registerAgentLinkProtocol({ ...base, setAsDefaultProtocolClient: () => false })).toBe(
      false,
    );
    expect(
      registerAgentLinkProtocol({
        ...base,
        setAsDefaultProtocolClient: () => {
          throw new Error("registry denied");
        },
      }),
    ).toBe(false);
  });
});

describe("installed copies", () => {
  it("never lets a portable or unpacked copy take over the scheme", () => {
    const calls: string[] = [];
    expect(
      registerAgentLinkProtocol({
        platform: "win32",
        isPackaged: true,
        isInstalledCopy: () => false,
        scheme: "woowtech-smart",
        setAsDefaultProtocolClient: (scheme) => {
          calls.push(scheme);
          return true;
        },
      }),
    ).toBe(false);
    expect(calls).toEqual([]);
  });

  it("looks for the NSIS uninstaller next to the executable", () => {
    expect(
      windowsUninstallerPath(
        "C:\\Users\\a\\AppData\\Local\\Programs\\woowtech smart\\woowtech smart.exe",
      ),
    ).toBe("C:\\Users\\a\\AppData\\Local\\Programs\\woowtech smart\\Uninstall woowtech smart.exe");
  });
});

describe("Windows launch flags", () => {
  it("treats an update relaunch and a COM toast activation as opening the app", () => {
    expect(hasWindowsLaunchFlag(["C:\\app\\woowtech smart.exe", "--updated"])).toBe(true);
    // LocalServer32 is unquoted, so the folder name splits into extra arguments.
    expect(
      hasWindowsLaunchFlag([
        "C:\\Users\\a\\woowtech",
        "smart\\woowtech",
        "smart.exe",
        "-Embedding",
      ]),
    ).toBe(true);
    expect(hasWindowsLaunchFlag(["app.exe", "/Embedding"])).toBe(true);
  });

  it("leaves CLI arguments alone", () => {
    expect(hasWindowsLaunchFlag(["app.exe", "ls", "--json"])).toBe(false);
    expect(hasWindowsLaunchFlag(["app.exe", "--updated-at", "now"])).toBe(false);
  });
});

describe("tray labels", () => {
  it("uses Traditional Chinese for Traditional Chinese systems", () => {
    for (const language of ["zh-Hant-TW", "zh-TW", "zh-HK", "zh-Hant"]) {
      expect(trayLabels({ appName: "woowtech smart", preferredLanguages: [language] })).toEqual({
        tooltip: "woowtech smart",
        open: "開啟 woowtech smart",
        quit: "結束",
      });
    }
  });

  it("keeps English elsewhere, Simplified Chinese included", () => {
    for (const languages of [["en-US"], ["zh-Hans-CN"], ["zh-CN"], ["ja-JP", "zh-TW"], []]) {
      expect(trayLabels({ appName: "woowtech smart", preferredLanguages: languages })).toEqual({
        tooltip: "woowtech smart",
        open: "Open woowtech smart",
        quit: "Quit",
      });
    }
  });
});

describe("first-close hint", () => {
  it("says where the app went in the system's language", () => {
    expect(trayHintText({ appName: "woowtech smart", preferredLanguages: ["zh-TW"] }).title).toBe(
      "woowtech smart 仍在執行",
    );
    const english = trayHintText({ appName: "woowtech smart", preferredLanguages: ["en-US"] });
    expect(english.title).toBe("woowtech smart is still running");
    expect(english.body).toContain("notification area");
  });
});

describe("closing the last window", () => {
  it("keeps the app running on macOS and in the Windows tray", () => {
    expect(quitWhenAllWindowsClosed({ platform: "darwin", trayActive: false })).toBe(false);
    expect(quitWhenAllWindowsClosed({ platform: "win32", trayActive: true })).toBe(false);
  });

  it("quits when Windows has no tray icon and on Linux", () => {
    expect(quitWhenAllWindowsClosed({ platform: "win32", trayActive: false })).toBe(true);
    expect(quitWhenAllWindowsClosed({ platform: "linux", trayActive: true })).toBe(true);
  });
});

describe("second launch", () => {
  it("brings back the existing window on Windows, like a Dock click", () => {
    expect(relaunchAction({ platform: "win32", hasAppLink: false, openProjectPath: null })).toBe(
      "focus",
    );
  });

  it("opens a window for a project path everywhere", () => {
    for (const platform of ["win32", "linux"] as const) {
      expect(relaunchAction({ platform, hasAppLink: false, openProjectPath: "D:\\repo" })).toBe(
        "open-window",
      );
    }
  });

  it("only focuses for non-agent app links such as pairing links", () => {
    for (const platform of ["win32", "linux"] as const) {
      expect(relaunchAction({ platform, hasAppLink: true, openProjectPath: null })).toBe("focus");
    }
  });

  it("keeps upstream's new window on Linux", () => {
    expect(relaunchAction({ platform: "linux", hasAppLink: false, openProjectPath: null })).toBe(
      "open-window",
    );
  });
});
