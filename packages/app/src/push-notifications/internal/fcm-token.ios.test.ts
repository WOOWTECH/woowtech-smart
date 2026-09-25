import { describe, expect, it } from "vitest";
import { createIosFcmTokenSource, type RnFirebaseMessaging } from "./fcm-token.ios";

const FCM_TOKEN = "dGVzdC1pbnN0YWxsYXRpb24:APA91bH-fake_fcm_token";

interface FakeHandle {
  app: "[DEFAULT]";
}

// A typed in-memory stand-in for @react-native-firebase/messaging's modular API.
function fakeRnFirebase(overrides: Partial<RnFirebaseMessaging<FakeHandle>> = {}) {
  const calls: string[] = [];
  const handle: FakeHandle = { app: "[DEFAULT]" };
  const module: RnFirebaseMessaging<FakeHandle> = {
    getMessaging: () => {
      calls.push("getMessaging");
      return handle;
    },
    registerDeviceForRemoteMessages: async (messaging) => {
      calls.push(`registerDeviceForRemoteMessages(${messaging.app})`);
    },
    getToken: async (messaging) => {
      calls.push(`getToken(${messaging.app})`);
      return FCM_TOKEN;
    },
    onTokenRefresh: () => () => undefined,
    ...overrides,
  };
  return { module, calls };
}

describe("iOS FCM token", () => {
  it("registers with APNs before asking FCM for the token, since firebase.json turns auto-registration off", async () => {
    const firebase = fakeRnFirebase();
    const source = createIosFcmTokenSource(() => firebase.module);

    await expect(source.getToken()).resolves.toBe(FCM_TOKEN);
    expect(firebase.calls).toEqual([
      "getMessaging",
      "registerDeviceForRemoteMessages([DEFAULT])",
      "getToken([DEFAULT])",
    ]);
  });

  it("loads React Native Firebase only when asked for a token, and gets null without it", async () => {
    // Without a GoogleService-Info.plist the native module is not linked, and importing
    // @react-native-firebase/messaging throws ("Native module RNFBAppModule is not registered").
    const loads: string[] = [];
    const warnings: string[] = [];
    const source = createIosFcmTokenSource(
      () => {
        loads.push("load");
        throw new Error("Native module RNFBAppModule is not registered.");
      },
      (message) => warnings.push(message),
    );
    expect(loads).toEqual([]);

    await expect(source.getToken()).resolves.toBeNull();
    expect(loads).toEqual(["load"]);
    expect(warnings).toEqual(["[PushNotifications] No FCM token on this device"]);
  });

  it("gets null when Firebase is not configured", async () => {
    const firebase = fakeRnFirebase({
      getMessaging: () => {
        throw new Error(
          "No Firebase App '[DEFAULT]' has been created - call firebase.initializeApp()",
        );
      },
    });
    const source = createIosFcmTokenSource(
      () => firebase.module,
      () => undefined,
    );

    await expect(source.getToken()).resolves.toBeNull();
  });

  it("gets null, without asking FCM, when APNs registration fails", async () => {
    const firebase = fakeRnFirebase({
      registerDeviceForRemoteMessages: async () => {
        throw new Error("remote notifications are not supported in the simulator");
      },
    });
    const source = createIosFcmTokenSource(
      () => firebase.module,
      () => undefined,
    );

    await expect(source.getToken()).resolves.toBeNull();
    expect(firebase.calls).toEqual(["getMessaging"]);
  });

  it("gets null for an empty token", async () => {
    const firebase = fakeRnFirebase({ getToken: async () => "" });
    const source = createIosFcmTokenSource(
      () => firebase.module,
      () => undefined,
    );

    await expect(source.getToken()).resolves.toBeNull();
  });

  it("passes each refreshed token to the listener until unsubscribed", () => {
    const listeners = new Set<(token: string) => void>();
    const firebase = fakeRnFirebase({
      onTokenRefresh: (_messaging, listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
    const source = createIosFcmTokenSource(
      () => firebase.module,
      () => undefined,
    );
    const received: string[] = [];

    const unsubscribe = source.onTokenRefresh((token) => received.push(token));
    for (const listener of listeners) listener("refreshed:token-1");
    unsubscribe();
    for (const listener of listeners) listener("refreshed:token-2");

    expect(received).toEqual(["refreshed:token-1"]);
    expect(listeners.size).toBe(0);
  });

  it("listens for nothing, without throwing, when React Native Firebase is not linked", () => {
    const source = createIosFcmTokenSource(
      () => {
        throw new Error("Native module RNFBAppModule is not registered.");
      },
      () => undefined,
    );

    const unsubscribe = source.onTokenRefresh(() => undefined);

    expect(unsubscribe()).toBeUndefined();
  });
});
