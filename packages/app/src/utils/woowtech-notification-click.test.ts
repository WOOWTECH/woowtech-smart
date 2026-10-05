import { describe, expect, it } from "vitest";
import { takePendingDesktopNotificationClick } from "./woowtech-notification-click";

describe("pending desktop notification click", () => {
  it("returns the data of a click that reopened this window", async () => {
    const data = { serverId: "s", terminalId: "t" };
    await expect(
      takePendingDesktopNotificationClick({ takePendingClick: async () => ({ data }) }),
    ).resolves.toEqual(data);
  });

  it("returns nothing without a pending click, a bridge, or usable data", async () => {
    await expect(
      takePendingDesktopNotificationClick({ takePendingClick: async () => null }),
    ).resolves.toBeUndefined();
    await expect(takePendingDesktopNotificationClick(undefined)).resolves.toBeUndefined();
    // A bridge without takePendingClick (plain web has no bridge at all).
    await expect(takePendingDesktopNotificationClick({})).resolves.toBeUndefined();
    await expect(
      takePendingDesktopNotificationClick({
        takePendingClick: async () => ({ data: [] as unknown as Record<string, unknown> }),
      }),
    ).resolves.toBeUndefined();
  });
});
