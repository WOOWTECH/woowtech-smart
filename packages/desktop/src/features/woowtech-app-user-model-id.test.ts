import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  WOOWTECH_DESKTOP_APP_ID,
  applyWindowsAppUserModelId,
} from "./woowtech-app-user-model-id.js";

function recorder() {
  const calls: string[] = [];
  return { calls, set: (id: string) => calls.push(id) };
}

describe("Windows AppUserModelID", () => {
  it("matches the electron-builder appId that the NSIS shortcut is registered with", () => {
    const config = readFileSync(path.resolve(__dirname, "../../electron-builder.yml"), "utf8");
    expect(config).toMatch(
      new RegExp(`^appId: ${WOOWTECH_DESKTOP_APP_ID.replace(/\./g, "\\.")}$`, "m"),
    );
  });

  it("sets the packaged app id on Windows", () => {
    const r = recorder();
    expect(
      applyWindowsAppUserModelId({
        platform: "win32",
        isPackaged: true,
        execPath: "C:\\app\\woowtech smart.exe",
        setAppUserModelId: r.set,
      }),
    ).toBe(WOOWTECH_DESKTOP_APP_ID);
    expect(r.calls).toEqual([WOOWTECH_DESKTOP_APP_ID]);
  });

  it("uses the Electron executable for unpackaged Windows runs", () => {
    const r = recorder();
    applyWindowsAppUserModelId({
      platform: "win32",
      isPackaged: false,
      execPath: "C:\\repo\\node_modules\\electron\\dist\\electron.exe",
      setAppUserModelId: r.set,
    });
    expect(r.calls).toEqual(["C:\\repo\\node_modules\\electron\\dist\\electron.exe"]);
  });

  it("does nothing on macOS and Linux", () => {
    for (const platform of ["darwin", "linux"] as const) {
      const r = recorder();
      expect(
        applyWindowsAppUserModelId({
          platform,
          isPackaged: true,
          execPath: "/x",
          setAppUserModelId: r.set,
        }),
      ).toBeNull();
      expect(r.calls).toEqual([]);
    }
  });
});
