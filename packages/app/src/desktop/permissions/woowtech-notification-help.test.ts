import { describe, expect, it } from "vitest";
import { desktopBannerCheckKeys, desktopNotificationHelpKeys } from "./woowtech-notification-help";

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

describe("the banner check's wording", () => {
  it("sends Windows users to the bottom right and to Settings › System › Notifications", () => {
    expect(desktopBannerCheckKeys("win32")).toEqual({
      idleDescription: "woowtech.notificationBannerCheck.idleDescriptionWindows",
      askDescription: "woowtech.notificationBannerCheck.askDescriptionWindows",
      helpDescription: "woowtech.notificationBannerCheck.helpDescriptionWindows",
    });
  });

  it("keeps the macOS wording elsewhere", () => {
    for (const platform of ["darwin", "linux", undefined]) {
      expect(desktopBannerCheckKeys(platform).askDescription).toBe(
        "woowtech.notificationBannerCheck.askDescription",
      );
    }
  });
});
