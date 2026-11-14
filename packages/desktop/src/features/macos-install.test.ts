import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkMacInstallDestination, macInstallCopy, offerMacInstall } from "./macos-install.js";

function fixture() {
  return {
    platform: "darwin" as NodeJS.Platform,
    argv: ["/Downloads/Smart.app/Contents/MacOS/Smart"],
    env: {} as NodeJS.ProcessEnv,
    appName: "Smart",
    hasPendingLaunch: vi.fn(() => false),
    app: {
      isPackaged: true,
      isInApplicationsFolder: vi.fn(() => false),
      getPreferredSystemLanguages: () => ["en"],
      moveToApplicationsFolder: vi.fn(
        (_options: { conflictHandler?: (type: string) => boolean }) => true,
      ),
    },
    dialog: { showMessageBoxSync: vi.fn(() => 0) },
    checkDestination: vi.fn((): "available" | "exists" | "manual" => "available"),
    onError: vi.fn(),
  };
}

describe("macOS installation before GUI services", () => {
  it("requires consent and hands successful relocation to Electron", () => {
    const runtime = fixture();
    expect(offerMacInstall(runtime)).toBe(true);
    expect(runtime.dialog.showMessageBoxSync).toHaveBeenCalledWith(
      expect.objectContaining({
        buttons: ["Install and Open", "Not Now"],
        cancelId: 1,
      }),
    );
    expect(runtime.app.moveToApplicationsFolder).toHaveBeenCalledOnce();
  });

  it("continues from the original location when declined", () => {
    const runtime = fixture();
    runtime.dialog.showMessageBoxSync.mockReturnValue(1);
    expect(offerMacInstall(runtime)).toBe(false);
    expect(runtime.checkDestination).not.toHaveBeenCalled();
    expect(runtime.app.moveToApplicationsFolder).not.toHaveBeenCalled();
  });

  it.each(["exists", "existsAndRunning"])("refuses native %s conflicts", (conflict) => {
    const runtime = fixture();
    runtime.app.moveToApplicationsFolder.mockImplementation((options) => {
      expect(options.conflictHandler!(conflict)).toBe(false);
      return false;
    });
    expect(offerMacInstall(runtime)).toBe(false);
    expect(runtime.dialog.showMessageBoxSync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: macInstallCopy("en", "Smart").exists,
      }),
    );
  });

  it.each(["exists", "manual"] as const)(
    "does not enter native copy for %s destinations",
    (destination) => {
      const runtime = fixture();
      runtime.checkDestination.mockReturnValue(destination);
      expect(offerMacInstall(runtime)).toBe(false);
      expect(runtime.app.moveToApplicationsFolder).not.toHaveBeenCalled();
    },
  );

  it.each(["cancel", "throw"])("shows recovery instructions on %s", (mode) => {
    const runtime = fixture();
    runtime.app.moveToApplicationsFolder.mockImplementation(() => {
      if (mode === "throw") throw new Error("copy denied");
      return false;
    });
    expect(offerMacInstall(runtime)).toBe(false);
    expect(runtime.dialog.showMessageBoxSync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: macInstallCopy("en", "Smart").failed,
      }),
    );
  });

  it.each(["dev", "installed", "linux", "pending", "headless", "update", "cli", "ci", "ssh"])(
    "skips %s launches without filesystem changes or dialogs",
    (mode) => {
      const runtime = fixture();
      if (mode === "dev") runtime.app.isPackaged = false;
      if (mode === "installed") runtime.app.isInApplicationsFolder.mockReturnValue(true);
      if (mode === "linux") runtime.platform = "linux";
      if (mode === "pending") runtime.hasPendingLaunch.mockReturnValue(true);
      if (mode === "headless") runtime.argv.push("--headless");
      if (mode === "update") runtime.argv.push("--squirrel-updated");
      if (mode === "cli") runtime.env.PASEO_DESKTOP_CLI = "1";
      if (mode === "ci") runtime.env.CI = "1";
      if (mode === "ssh") runtime.env.SSH_CONNECTION = "test";
      expect(offerMacInstall(runtime)).toBe(false);
      expect(runtime.dialog.showMessageBoxSync).not.toHaveBeenCalled();
      expect(runtime.checkDestination).not.toHaveBeenCalled();
      expect(runtime.app.moveToApplicationsFolder).not.toHaveBeenCalled();
    },
  );

  it("preserves a launch intent received during the confirmation", () => {
    const runtime = fixture();
    runtime.hasPendingLaunch.mockReturnValueOnce(false).mockReturnValue(true);
    expect(offerMacInstall(runtime)).toBe(false);
    expect(runtime.app.moveToApplicationsFolder).not.toHaveBeenCalled();
  });

  it.each(["zh-TW", "zh-Hant", "zh-HK"])("offers Traditional Chinese for %s", (locale) => {
    expect(macInstallCopy(locale, "Apporo").prompt).toBe("將 Apporo 安裝至「應用程式」？");
  });
  it("falls back to English for other languages", () => {
    expect(macInstallCopy("ja", "Apporo").prompt).toBe("Install Apporo in Applications?");
  });
});

describe("installation destination on disk", () => {
  const roots: string[] = [];
  afterEach(() =>
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })),
  );
  function disk() {
    const root = mkdtempSync(path.join(os.tmpdir(), "mac-install-"));
    roots.push(root);
    const input = {
      execPath: "/Downloads/Smart.app/Contents/MacOS/Smart",
      home: root,
      applications: path.join(root, "SystemApplications"),
    };
    mkdirSync(input.applications);
    return input;
  }
  it("accepts an empty writable Applications directory", () => {
    expect(checkMacInstallDestination(disk())).toBe("available");
  });
  it.each(["system", "user"])(
    "preserves every existing %s version without comparing version strings",
    (location) => {
      const input = disk();
      const directory =
        location === "system" ? input.applications : path.join(input.home, "Applications");
      mkdirSync(path.join(directory, "Smart.app"), { recursive: true });
      expect(checkMacInstallDestination(input)).toBe("exists");
    },
  );
  it("refuses a dangling destination symlink", () => {
    const input = disk();
    symlinkSync("/does-not-exist", path.join(input.applications, "Smart.app"));
    expect(checkMacInstallDestination(input)).toBe("exists");
  });
  it("requires manual installation if Applications is unavailable", () => {
    const input = disk();
    rmSync(input.applications, { recursive: true });
    expect(checkMacInstallDestination(input)).toBe("manual");
  });
});
