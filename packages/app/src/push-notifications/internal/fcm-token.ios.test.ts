import { describe, expect, it } from "vitest";
import {
  createIosFcmTokenSource,
  type IosFcmTokenSourceOptions,
  type RnFirebaseMessaging,
} from "./fcm-token.ios";

const FCM_TOKEN = "dGVzdC1pbnN0YWxsYXRpb24:APA91bH-fake_fcm_token";
const APNS_TOKEN = "3f0e5a9c1b2d4e6f8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f";

interface FakeHandle {
  app: "[DEFAULT]";
}

/** A React Native Firebase error as its native module rejects, such as messaging/registration-timeout. */
function rnFirebaseError(code: string): Error {
  return Object.assign(new Error(`[${code}] (fake)`), { code });
}

/**
 * A typed in-memory stand-in for @react-native-firebase/messaging's modular API (26.4) and the
 * APNs registration expo-notifications asks UIKit for. Like Firebase, getToken fails while
 * Firebase has no APNs token in this process.
 */
function fakeIos(
  options: {
    /** Whether RNFB's registration hands Firebase the APNs token (a first launch) or skips UIKit. */
    registrationSetsApnsToken?: boolean;
    overrides?: Partial<RnFirebaseMessaging<FakeHandle>>;
    apnsRegistration?: () => Promise<unknown>;
  } = {},
) {
  const calls: string[] = [];
  const handle: FakeHandle = { app: "[DEFAULT]" };
  let apnsToken: string | null = null;
  const module: RnFirebaseMessaging<FakeHandle> = {
    getMessaging: () => {
      calls.push("getMessaging");
      return handle;
    },
    registerDeviceForRemoteMessages: async (messaging) => {
      calls.push(`registerDeviceForRemoteMessages(${messaging.app})`);
      if (options.registrationSetsApnsToken ?? true) apnsToken = APNS_TOKEN;
    },
    getAPNSToken: async (messaging) => {
      calls.push(`getAPNSToken(${messaging.app})`);
      return apnsToken;
    },
    getToken: async (messaging) => {
      calls.push(`getToken(${messaging.app})`);
      if (apnsToken === null) {
        throw rnFirebaseError("messaging/unknown"); // No APNS token specified before fetching FCM Token
      }
      return FCM_TOKEN;
    },
    onTokenRefresh: () => () => undefined,
    ...options.overrides,
  };
  const registerWithApns =
    options.apnsRegistration ??
    (async () => {
      calls.push("expo-notifications getDevicePushTokenAsync");
      apnsToken = APNS_TOKEN;
    });
  return { module, calls, registerWithApns };
}

type FakeIos = ReturnType<typeof fakeIos>;

function tokenSource(ios: FakeIos, options: Partial<IosFcmTokenSourceOptions<FakeHandle>> = {}) {
  return createIosFcmTokenSource<FakeHandle>({
    loadMessaging: () => ios.module,
    loadApnsRegistration: () => ios.registerWithApns,
    warn: () => undefined,
    // iOS answers in these tests; nothing waits for the APNs deadline.
    sleep: () => new Promise<void>(() => undefined),
    ...options,
  });
}

describe("iOS FCM token", () => {
  it("registers with APNs before asking FCM for the token, since firebase.json turns auto-registration off", async () => {
    const ios = fakeIos();

    await expect(tokenSource(ios).getToken()).resolves.toBe(FCM_TOKEN);
    expect(ios.calls).toEqual([
      "getMessaging",
      "registerDeviceForRemoteMessages([DEFAULT])",
      "getAPNSToken([DEFAULT])",
      "getToken([DEFAULT])",
    ]);
  });

  it("asks UIKit for the APNs token when iOS says the app is registered already, as in every later launch", async () => {
    // RNFB resolves at once when isRegisteredForRemoteNotifications is YES, and Firebase keeps
    // the APNs token in memory only: without asking UIKit again, getToken fails every launch.
    const ios = fakeIos({ registrationSetsApnsToken: false });

    await expect(tokenSource(ios).getToken()).resolves.toBe(FCM_TOKEN);
    expect(ios.calls).toEqual([
      "getMessaging",
      "registerDeviceForRemoteMessages([DEFAULT])",
      "getAPNSToken([DEFAULT])",
      "expo-notifications getDevicePushTokenAsync",
      "getToken([DEFAULT])",
    ]);
  });

  it("gets null, and says why, when iOS does not hand over the APNs token in time", async () => {
    const warnings: string[] = [];
    const ios = fakeIos({
      registrationSetsApnsToken: false,
      apnsRegistration: () => new Promise(() => undefined),
    });
    const source = tokenSource(ios, {
      warn: (message) => warnings.push(message),
      sleep: async () => undefined,
    });

    await expect(source.getToken()).resolves.toBeNull();
    expect(ios.calls).not.toContain("getToken([DEFAULT])");
    expect(warnings).toEqual([
      "[PushNotifications] No FCM token on this device (push/apns-timeout)",
    ]);
  });

  it("shares one registration between callers at once, which React Native Firebase would supersede", async () => {
    // RNFB rejects a pending registerDeviceForRemoteMessages with registration-superseded when
    // another starts before it settles; each daemon's subscription asks for the token.
    let pending: ((error: Error) => void) | null = null;
    const ios = fakeIos({
      overrides: {
        registerDeviceForRemoteMessages: (messaging) =>
          new Promise<void>((resolve, reject) => {
            ios.calls.push(`registerDeviceForRemoteMessages(${messaging.app})`);
            pending?.(rnFirebaseError("messaging/registration-superseded"));
            pending = reject;
            setImmediate(() => {
              if (pending !== reject) return;
              pending = null;
              resolve();
            });
          }),
        getAPNSToken: async () => APNS_TOKEN,
        getToken: async () => FCM_TOKEN,
      },
    });
    const source = tokenSource(ios);

    await expect(Promise.all([source.getToken(), source.getToken()])).resolves.toEqual([
      FCM_TOKEN,
      FCM_TOKEN,
    ]);
    expect(ios.calls.filter((call) => call.startsWith("registerDevice"))).toHaveLength(1);

    // Settled, the next caller registers again.
    await expect(source.getToken()).resolves.toBe(FCM_TOKEN);
    expect(ios.calls.filter((call) => call.startsWith("registerDevice"))).toHaveLength(2);
  });

  it.each(["messaging/registration-superseded", "messaging/registration-timeout"])(
    "tries the registration once more after %s",
    async (code) => {
      const failures = [rnFirebaseError(code)];
      const ios = fakeIos({
        overrides: {
          registerDeviceForRemoteMessages: async (messaging) => {
            ios.calls.push(`registerDeviceForRemoteMessages(${messaging.app})`);
            const failure = failures.shift();
            if (failure) throw failure;
          },
          getAPNSToken: async () => APNS_TOKEN,
          getToken: async () => FCM_TOKEN,
        },
      });

      await expect(tokenSource(ios).getToken()).resolves.toBe(FCM_TOKEN);
      expect(ios.calls.filter((call) => call.startsWith("registerDevice"))).toHaveLength(2);
    },
  );

  it("gets null, naming the error, when the registration fails twice", async () => {
    const warnings: string[] = [];
    const ios = fakeIos({
      overrides: {
        registerDeviceForRemoteMessages: async (messaging) => {
          ios.calls.push(`registerDeviceForRemoteMessages(${messaging.app})`);
          throw rnFirebaseError("messaging/registration-timeout");
        },
      },
    });

    await expect(
      tokenSource(ios, { warn: (message) => warnings.push(message) }).getToken(),
    ).resolves.toBeNull();
    expect(ios.calls.filter((call) => call.startsWith("registerDevice"))).toHaveLength(2);
    expect(warnings).toEqual([
      "[PushNotifications] No FCM token on this device (messaging/registration-timeout)",
    ]);
  });

  it("loads React Native Firebase only when asked for a token, and gets null without it", async () => {
    // Without a GoogleService-Info.plist the native module is not linked, and importing
    // @react-native-firebase/messaging throws ("Native module RNFBAppModule is not registered").
    const loads: string[] = [];
    const warnings: string[] = [];
    const source = createIosFcmTokenSource<FakeHandle>({
      loadMessaging: () => {
        loads.push("load");
        throw new Error("Native module RNFBAppModule is not registered.");
      },
      loadApnsRegistration: () => fakeIos().registerWithApns,
      warn: (message) => warnings.push(message),
    });
    expect(loads).toEqual([]);

    await expect(source.getToken()).resolves.toBeNull();
    expect(loads).toEqual(["load"]);
    expect(warnings).toEqual(["[PushNotifications] No FCM token on this device (Error)"]);
  });

  it("gets null when Firebase is not configured", async () => {
    const ios = fakeIos({
      overrides: {
        getMessaging: () => {
          throw new Error(
            "No Firebase App '[DEFAULT]' has been created - call firebase.initializeApp()",
          );
        },
      },
    });

    await expect(tokenSource(ios).getToken()).resolves.toBeNull();
  });

  it("gets null, without asking FCM, when APNs registration fails", async () => {
    const ios = fakeIos({
      overrides: {
        registerDeviceForRemoteMessages: async () => {
          throw new Error("remote notifications are not supported in the simulator");
        },
      },
    });

    await expect(tokenSource(ios).getToken()).resolves.toBeNull();
    expect(ios.calls).toEqual(["getMessaging"]);
  });

  it("gets null for an empty token", async () => {
    const ios = fakeIos({ overrides: { getToken: async () => "" } });

    await expect(tokenSource(ios).getToken()).resolves.toBeNull();
  });

  it("passes each refreshed token to the listener until unsubscribed", () => {
    const listeners = new Set<(token: string) => void>();
    const ios = fakeIos({
      overrides: {
        onTokenRefresh: (_messaging, listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
    });
    const received: string[] = [];

    const unsubscribe = tokenSource(ios).onTokenRefresh((token) => received.push(token));
    for (const listener of listeners) listener("refreshed:token-1");
    unsubscribe();
    for (const listener of listeners) listener("refreshed:token-2");

    expect(received).toEqual(["refreshed:token-1"]);
    expect(listeners.size).toBe(0);
  });

  it("listens for nothing, without throwing, when React Native Firebase is not linked", () => {
    const source = createIosFcmTokenSource<FakeHandle>({
      loadMessaging: () => {
        throw new Error("Native module RNFBAppModule is not registered.");
      },
      loadApnsRegistration: () => fakeIos().registerWithApns,
      warn: () => undefined,
    });

    const unsubscribe = source.onTokenRefresh(() => undefined);

    expect(unsubscribe()).toBeUndefined();
  });
});
