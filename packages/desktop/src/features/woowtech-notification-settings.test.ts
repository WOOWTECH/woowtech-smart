// woowtech smart: tests for woowtech-notification-settings.ts (woowtech/README.md section 16).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  notificationSettingsUrl,
  openSystemNotificationSettings,
} from "./woowtech-notification-settings";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the system notification settings", () => {
  it("open the Notifications pane of System Settings on macOS", async () => {
    const opened: string[] = [];

    const result = await openSystemNotificationSettings({
      platform: "darwin",
      openExternal: async (url) => {
        opened.push(url);
      },
    });

    expect(result).toBe(true);
    expect(opened).toEqual([
      "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
    ]);
  });

  it("open Settings > Notifications on Windows", () => {
    expect(notificationSettingsUrl("win32")).toBe("ms-settings:notifications");
  });

  it("have no page on Linux", async () => {
    const openExternal = vi.fn(async () => undefined);

    await expect(openSystemNotificationSettings({ platform: "linux", openExternal })).resolves.toBe(
      false,
    );
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("report false when the system refuses to open them", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      openSystemNotificationSettings({
        platform: "darwin",
        openExternal: async () => {
          throw new Error("no handler");
        },
      }),
    ).resolves.toBe(false);
  });
});
