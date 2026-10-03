import { describe, expect, it } from "vitest";
import { desktopNotificationHelpKeys } from "./woowtech-notification-help";

describe("desktop notification help", () => {
  it("points Windows users at Settings › System › Notifications", () => {
    expect(desktopNotificationHelpKeys("win32")).toEqual({
      failed: "woowtech.desktopNotifications.failedWindows",
      unconfirmed: "woowtech.desktopNotifications.unconfirmedWindows",
    });
  });

  it("keeps the macOS wording elsewhere", () => {
    for (const platform of ["darwin", "linux", undefined]) {
      expect(desktopNotificationHelpKeys(platform).failed).toBe(
        "woowtech.desktopNotifications.failed",
      );
    }
  });
});
