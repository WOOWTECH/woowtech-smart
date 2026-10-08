// woowtech smart: tests for woowtech-settings-swipe-back.ts (woowtech/README.md section 14).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SETTINGS_SWIPE_BACK_MAX_WIDTH,
  settingsScreenOptionsFor,
} from "./woowtech-settings-swipe-back";

const SWIPE_BACK = { animation: "default", gestureEnabled: true };

describe("settings pages", () => {
  it("get the iOS push animation, and with it the edge swipe back, on an iPhone-width layout", () => {
    expect(settingsScreenOptionsFor({ os: "ios", windowWidth: 390 })).toEqual(SWIPE_BACK);
    expect(settingsScreenOptionsFor({ os: "ios", windowWidth: 719 })).toEqual(SWIPE_BACK);
  });

  it("keep the root stack's no animation on a wide layout, where one page replaces the next", () => {
    expect(settingsScreenOptionsFor({ os: "ios", windowWidth: 720 })).toBeUndefined();
    expect(settingsScreenOptionsFor({ os: "ios", windowWidth: 1180 })).toBeUndefined();
  });

  it("keep it on Android, the web and the desktop", () => {
    for (const os of ["android", "web", "macos", "windows"]) {
      expect(settingsScreenOptionsFor({ os, windowWidth: 390 })).toBeUndefined();
    }
  });

  it("use the width where the layout stops being compact", () => {
    const unistyles = readFileSync(join(__dirname, "../styles/unistyles.ts"), "utf8");
    expect(unistyles).toContain(`md: ${SETTINGS_SWIPE_BACK_MAX_WIDTH},`);
  });
});
