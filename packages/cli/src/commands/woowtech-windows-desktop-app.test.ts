import { describe, expect, it } from "vitest";

import { windowsDesktopAppPath } from "./woowtech-windows-desktop-app.js";

const LOCAL = "C:\\Users\\a\\AppData\\Local";
const DEFAULT_EXE = `${LOCAL}\\Programs\\woowtech smart\\woowtech smart.exe`;

describe("windowsDesktopAppPath", () => {
  it("uses the app the bundled CLI runs in, even from a custom install folder", () => {
    expect(
      windowsDesktopAppPath({
        env: { ELECTRON_RUN_AS_NODE: "1", LOCALAPPDATA: LOCAL },
        execPath: "D:\\Apps\\woowtech smart\\woowtech smart.exe",
        exists: () => false,
      }),
    ).toBe("D:\\Apps\\woowtech smart\\woowtech smart.exe");
  });

  it("falls back to the per-user install folder for another node", () => {
    expect(
      windowsDesktopAppPath({
        env: { LOCALAPPDATA: LOCAL },
        execPath: "C:\\Program Files\\nodejs\\node.exe",
        exists: (filePath) => filePath === DEFAULT_EXE,
      }),
    ).toBe(DEFAULT_EXE);
    expect(
      windowsDesktopAppPath({
        env: { ELECTRON_RUN_AS_NODE: "1", LOCALAPPDATA: LOCAL },
        execPath: "C:\\Program Files\\Other\\other.exe",
        exists: () => false,
      }),
    ).toBeNull();
  });
});
