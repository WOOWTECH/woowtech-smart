import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  WOOWTECH_DESKTOP_APP_ID,
  WOOWTECH_DEV_APP_ID,
  WOOWTECH_DEV_TOAST_ACTIVATOR_CLSID,
  WOOWTECH_TOAST_ACTIVATOR_CLSID,
  applyWindowsAppUserModelId,
} from "./woowtech-app-user-model-id.js";

function recorder() {
  const ids: string[] = [];
  const clsids: string[] = [];
  return {
    ids,
    clsids,
    setAppUserModelId: (id: string) => ids.push(id),
    setToastActivatorCLSID: (clsid: string) => clsids.push(clsid),
  };
}

describe("Windows AppUserModelID", () => {
  it("matches the electron-builder appId that the NSIS shortcut is registered with", () => {
    const config = readFileSync(path.resolve(__dirname, "../../electron-builder.yml"), "utf8");
    expect(config).toMatch(
      new RegExp(`^appId: ${WOOWTECH_DESKTOP_APP_ID.replace(/\./g, "\\.")}$`, "m"),
    );
  });

  it("sets the packaged app id and a fixed toast activator on Windows", () => {
    const r = recorder();
    expect(applyWindowsAppUserModelId({ platform: "win32", isPackaged: true, ...r })).toBe(
      WOOWTECH_DESKTOP_APP_ID,
    );
    expect(r.ids).toEqual([WOOWTECH_DESKTOP_APP_ID]);
    expect(r.clsids).toEqual([WOOWTECH_TOAST_ACTIVATOR_CLSID]);
  });

  it("keeps unpackaged Windows runs apart from the installed app", () => {
    const r = recorder();
    expect(applyWindowsAppUserModelId({ platform: "win32", isPackaged: false, ...r })).toBe(
      WOOWTECH_DEV_APP_ID,
    );
    expect(r.ids).toEqual(["io.woowtech.smart.desktop.dev"]);
    expect(r.clsids).toEqual([WOOWTECH_DEV_TOAST_ACTIVATOR_CLSID]);
    expect(WOOWTECH_DEV_TOAST_ACTIVATOR_CLSID).not.toBe(WOOWTECH_TOAST_ACTIVATOR_CLSID);
  });

  it("uses ids Windows accepts: no spaces, at most 128 characters, braced GUIDs", () => {
    for (const id of [WOOWTECH_DESKTOP_APP_ID, WOOWTECH_DEV_APP_ID]) {
      expect(id).not.toMatch(/\s/);
      expect(id.length).toBeLessThanOrEqual(128);
    }
    for (const clsid of [WOOWTECH_TOAST_ACTIVATOR_CLSID, WOOWTECH_DEV_TOAST_ACTIVATOR_CLSID]) {
      expect(clsid).toMatch(/^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/);
    }
  });

  it("does nothing on macOS and Linux", () => {
    for (const platform of ["darwin", "linux"] as const) {
      const r = recorder();
      expect(applyWindowsAppUserModelId({ platform, isPackaged: true, ...r })).toBeNull();
      expect(r.ids).toEqual([]);
      expect(r.clsids).toEqual([]);
    }
  });
});
