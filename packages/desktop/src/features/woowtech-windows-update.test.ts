import { describe, expect, it } from "vitest";

import { installsUpdateOnQuit, updateInstallMode } from "./woowtech-windows-update.js";

describe("installing a downloaded update", () => {
  it("never installs at quit on Windows, where a shutdown can cut the installer off", () => {
    expect(installsUpdateOnQuit("win32")).toBe(false);
    expect(installsUpdateOnQuit("darwin")).toBe(true);
    expect(installsUpdateOnQuit("linux")).toBe(true);
  });

  it("restarts silently on Windows instead of showing the installer's wizard", () => {
    expect(
      updateInstallMode({ platform: "win32", isSilent: false, isForceRunAfter: true }),
    ).toEqual({ isSilent: true, isForceRunAfter: true });
  });

  it("leaves other requests and other systems as asked", () => {
    expect(
      updateInstallMode({ platform: "win32", isSilent: true, isForceRunAfter: false }),
    ).toEqual({ isSilent: true, isForceRunAfter: false });
    expect(
      updateInstallMode({ platform: "darwin", isSilent: false, isForceRunAfter: true }),
    ).toEqual({ isSilent: false, isForceRunAfter: true });
  });
});
