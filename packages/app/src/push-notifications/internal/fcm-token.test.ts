import { describe, expect, it } from "vitest";
import { fcmTokenSource } from "./fcm-token";

describe("FCM token on web and desktop", () => {
  it("does not exist: woowtech push is for the phone apps", async () => {
    await expect(fcmTokenSource.getToken()).resolves.toBeNull();
    expect(fcmTokenSource.onTokenRefresh(() => undefined)()).toBeUndefined();
  });
});
