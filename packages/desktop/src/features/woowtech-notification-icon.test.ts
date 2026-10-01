import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { notificationIconCandidates } from "./woowtech-notification-icon.js";

describe("notification icon candidates", () => {
  it("uses the icon.png that electron-builder copies into the packaged resources", () => {
    expect(
      notificationIconCandidates({
        isPackaged: true,
        resourcesPath: "/Applications/woowtech smart.app/Contents/Resources",
        moduleDir: "/ignored/dist/features",
      }),
    ).toEqual([path.join("/Applications/woowtech smart.app/Contents/Resources", "icon.png")]);
  });

  it("resolves the desktop package assets from the compiled features folder in development", () => {
    const desktopRoot = path.resolve(__dirname, "../..");
    const candidates = notificationIconCandidates({
      isPackaged: false,
      resourcesPath: "/ignored",
      moduleDir: path.join(desktopRoot, "dist", "features"),
    });
    expect(candidates).toEqual([
      path.join(desktopRoot, "assets", "icon.png"),
      path.join(desktopRoot, "assets", "64x64.png"),
      path.join(desktopRoot, "assets", "128x128.png"),
    ]);
    for (const candidate of candidates) {
      expect(existsSync(candidate), candidate).toBe(true);
    }
  });
});
