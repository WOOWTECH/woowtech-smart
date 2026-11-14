import { DESKTOP_APP_NAME } from "@getpaseo/protocol/brand-desktop";
import { describe, expect, it } from "vitest";

import { windowsDesktopAppPath } from "./woowtech-windows-desktop-app.js";

const LOCAL = "C:\\Users\\a\\AppData\\Local";
const DEFAULT_EXE = `${LOCAL}\\Programs\\${DESKTOP_APP_NAME}\\${DESKTOP_APP_NAME}.exe`;

describe("windowsDesktopAppPath", () => {
  it("uses the app the bundled CLI runs in, even from a custom install folder", () => {
    expect(
      windowsDesktopAppPath({
        env: { ELECTRON_RUN_AS_NODE: "1", LOCALAPPDATA: LOCAL },
        execPath: `D:\\Apps\\${DESKTOP_APP_NAME}\\${DESKTOP_APP_NAME}.exe`,
        exists: () => false,
      }),
    ).toBe(`D:\\Apps\\${DESKTOP_APP_NAME}\\${DESKTOP_APP_NAME}.exe`);
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
