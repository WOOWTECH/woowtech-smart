// woowtech smart: tests for woowtech-settings-swipe-back.ts (woowtech/README.md section 25).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SETTINGS_SWIPE_BACK_EDGE_WIDTH,
  SETTINGS_SWIPE_BACK_MAX_WIDTH,
  settingsScreenOptionsFor,
} from "./woowtech-settings-swipe-back";

const SWIPE_BACK = {
  animation: "default",
  gestureEnabled: true,
  fullScreenGestureEnabled: true,
  gestureResponseDistance: { end: SETTINGS_SWIPE_BACK_EDGE_WIDTH },
};

describe("settings pages", () => {
  it("go back with a swipe from the left edge on an iPhone-width layout", () => {
    expect(settingsScreenOptionsFor({ os: "ios", windowWidth: 390 })).toEqual(SWIPE_BACK);
    expect(settingsScreenOptionsFor({ os: "ios", windowWidth: 719 })).toEqual(SWIPE_BACK);
  });

  it("take the swipe only near the left edge, so a drag across the page stays on it", () => {
    const distance = settingsScreenOptionsFor({
      os: "ios",
      windowWidth: 390,
    })?.gestureResponseDistance;
    expect(distance).toEqual({ end: SETTINGS_SWIPE_BACK_EDGE_WIDTH });
    // A drag from 30% of a 390-point screen went back before the limit (2026-10-08).
    expect(SETTINGS_SWIPE_BACK_EDGE_WIDTH).toBeLessThan(390 * 0.3);
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
