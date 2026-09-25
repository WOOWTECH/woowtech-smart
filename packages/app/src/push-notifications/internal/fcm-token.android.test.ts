import { describe, expect, it } from "vitest";
import { createAndroidFcmTokenSource, type ExpoPushTokens } from "./fcm-token.android";

const FCM_TOKEN = "dGVzdC1pbnN0YWxsYXRpb24:APA91bH-fake_fcm_token";

// A typed in-memory stand-in for the expo-notifications functions the Android token uses.
function fakeExpoNotifications(overrides: Partial<ExpoPushTokens> = {}): ExpoPushTokens {
  return {
    getDevicePushTokenAsync: async () => ({ type: "android", data: FCM_TOKEN }),
    addPushTokenListener: () => ({ remove: () => undefined }),
    ...overrides,
  };
}

describe("Android FCM token", () => {
  it("is the device push token expo-notifications gets from Firebase", async () => {
    const source = createAndroidFcmTokenSource(() => fakeExpoNotifications());

    await expect(source.getToken()).resolves.toBe(FCM_TOKEN);
  });

  it("gets null without google-services.json, where Firebase is not initialized", async () => {
    const warnings: string[] = [];
    const source = createAndroidFcmTokenSource(
      () =>
        fakeExpoNotifications({
          getDevicePushTokenAsync: async () => {
            throw new Error(
              "Default FirebaseApp is not initialized in this process io.woowtech.smart.debug.",
            );
          },
        }),
      (message) => warnings.push(message),
    );

    await expect(source.getToken()).resolves.toBeNull();
    expect(warnings).toEqual(["[PushNotifications] No FCM token on this device"]);
  });

  it("gets null from a build whose expo-notifications has no push tokens (the F-Droid stub)", async () => {
    const fdroidStub = {} as ExpoPushTokens;
    const source = createAndroidFcmTokenSource(
      () => fdroidStub,
      () => undefined,
    );

    await expect(source.getToken()).resolves.toBeNull();
    expect(source.onTokenRefresh(() => undefined)()).toBeUndefined();
  });

  it("passes each new token expo-notifications reports to the listener until unsubscribed", () => {
    const listeners = new Set<Parameters<ExpoPushTokens["addPushTokenListener"]>[0]>();
    const source = createAndroidFcmTokenSource(
      () =>
        fakeExpoNotifications({
          addPushTokenListener: (listener) => {
            listeners.add(listener);
            return { remove: () => listeners.delete(listener) };
          },
        }),
      () => undefined,
    );
    const received: string[] = [];

    const unsubscribe = source.onTokenRefresh((token) => received.push(token));
    for (const listener of listeners) listener({ type: "android", data: "refreshed:token-1" });
    unsubscribe();
    for (const listener of listeners) listener({ type: "android", data: "refreshed:token-2" });

    expect(received).toEqual(["refreshed:token-1"]);
    expect(listeners.size).toBe(0);
  });
});
