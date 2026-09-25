import type { ConnectionState, DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { describe, expect, it } from "vitest";
import { createAndroidFcmTokenSource, type ExpoPushTokens } from "./fcm-token.android";
import { createIosFcmTokenSource, type RnFirebaseMessaging } from "./fcm-token.ios";
import {
  createWoowtechPushSubscriptions,
  type PushDaemonClient,
  type WoowtechPushDependencies,
} from "./woowtech-subscriptions";

const SERVER_ID = "srv_Ab3dEf9hIjK_";
const CACHE_KEY = `@paseo:expo-push-token:${SERVER_ID}`;
const FCM_TOKEN = "dGVzdC1pbnN0YWxsYXRpb24:APA91bH-fake_fcm_token";

type Features = NonNullable<ReturnType<DaemonClient["getLastServerInfoMessage"]>>["features"];

// A typed in-memory daemon connection: records what the app registers and revokes.
class FakeDaemonClient implements PushDaemonClient {
  readonly registered: string[] = [];
  readonly revoked: string[] = [];
  /** Registrations and revocations in the order the daemon received them. */
  readonly received: string[] = [];
  private state: ConnectionState = { status: "disconnected" };
  private readonly listeners = new Set<(state: ConnectionState) => void>();

  constructor(private readonly features: Features) {}

  get isConnected(): boolean {
    return this.state.status === "connected";
  }

  connect(): void {
    this.setState({ status: "connected" });
  }

  disconnect(): void {
    this.setState({ status: "disconnected" });
  }

  getLastServerInfoMessage(): ReturnType<DaemonClient["getLastServerInfoMessage"]> {
    if (!this.isConnected) return null;
    return {
      status: "server_info",
      serverId: SERVER_ID,
      hostname: "workstation",
      version: "0.8.0",
      features: this.features,
    };
  }

  subscribeConnectionStatus(listener: (state: ConnectionState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  registerPushToken(token: string): void {
    this.registered.push(token);
    this.received.push(`register ${token}`);
  }

  revocationError: Error | null = null;

  async unregisterPushToken(token: string): Promise<void> {
    if (this.revocationError) throw this.revocationError;
    this.revoked.push(token);
    this.received.push(`revoke ${token}`);
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}

const WOOWTECH_DAEMON: Features = { woowtechPush: true, pushTokenRevocation: true };
const PASEO_DAEMON: Features = { pushTokenRevocation: true };

function createPhone(options: { permission?: boolean; fcmToken?: string | null } = {}) {
  const storage = new Map<string, string>();
  const events: string[] = [];
  let fcmToken = options.fcmToken === undefined ? FCM_TOKEN : options.fcmToken;
  let language = "zh-TW";
  const refreshListeners = new Set<(token: string) => void>();
  const languageListeners = new Set<(language: string) => void>();
  const dependencies: WoowtechPushDependencies = {
    storage: {
      getItem: async (key) => storage.get(key) ?? null,
      setItem: async (key, value) => {
        storage.set(key, value);
      },
      removeItem: async (key) => {
        storage.delete(key);
      },
    },
    notificationPermission: async ({ mayAsk }) => {
      events.push(`permission(mayAsk=${mayAsk})`);
      return options.permission ?? true;
    },
    prepareNotificationChannel: async () => {
      events.push("channel");
    },
    fcmTokens: {
      getToken: async () => {
        events.push("getToken");
        return fcmToken;
      },
      onTokenRefresh: (listener) => {
        events.push("onTokenRefresh");
        refreshListeners.add(listener);
        return () => refreshListeners.delete(listener);
      },
    },
    appLanguage: {
      current: () => language,
      subscribe: (listener) => {
        languageListeners.add(listener);
        return () => languageListeners.delete(listener);
      },
    },
    disableExpoServerRegistration: async () => {
      events.push("disableExpoServerRegistration");
    },
    warn: () => undefined,
  };
  return {
    dependencies,
    storage,
    events,
    setFcmToken(token: string | null) {
      fcmToken = token;
    },
    /** Firebase hands the app a new FCM token. */
    refreshFcmToken(token: string) {
      fcmToken = token;
      for (const listener of refreshListeners) listener(token);
    },
    refreshListenerCount: () => refreshListeners.size,
    /** The user picks another language in the app's settings (i18next "languageChanged"). */
    changeLanguage(next: string) {
      language = next;
      for (const listener of languageListeners) listener(next);
    },
  };
}

// The fakes resolve through microtasks only, so one macrotask turn settles every async step.
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

/** Several macrotask turns: long enough for a sync that schedules itself to run again, and again. */
async function settleTurns(turns: number): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) await settle();
}

type DevicePushToken = Awaited<ReturnType<ExpoPushTokens["getDevicePushTokenAsync"]>>;

/**
 * expo-notifications on Android as its PushTokenModule.kt behaves (0.32): getDevicePushTokenAsync
 * resolves with the FCM token, then emits onDevicePushToken with that same token. The bridge may
 * deliver the event to JS before or after the promise.
 */
function androidExpoNotifications(
  fcmToken: () => string,
  eventArrives: "after" | "before" = "after",
): ExpoPushTokens {
  const listeners = new Set<(token: DevicePushToken) => void>();
  const emit = (token: DevicePushToken) => {
    for (const listener of listeners) listener(token);
  };
  return {
    getDevicePushTokenAsync: async () => {
      const token: DevicePushToken = { type: "android", data: fcmToken() };
      if (eventArrives === "before") emit(token);
      else setImmediate(() => emit(token));
      return token;
    },
    addPushTokenListener: (listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
}

describe("woowtech push subscription", () => {
  it("registers nothing with a daemon that does not push through WoowTech's relay", async () => {
    const phone = createPhone();
    const client = new FakeDaemonClient(PASEO_DAEMON);
    const { startSubscription } = createWoowtechPushSubscriptions(phone.dependencies);

    startSubscription({ client, serverId: SERVER_ID });
    client.connect();
    await settle();

    expect(client.registered).toEqual([]);
    expect(phone.events).toEqual(["disableExpoServerRegistration"]);
  });

  it("revokes the Expo token an older build registered with a daemon that does not relay, asking nothing", async () => {
    // Such a daemon (the official Paseo one, or ours from before the relay) sends each push with
    // the agent's reply to Expo, for as long as the old token's 48-hour lease lasts.
    const phone = createPhone();
    phone.storage.set(CACHE_KEY, "ExponentPushToken[old-test-build]");
    const client = new FakeDaemonClient(PASEO_DAEMON);
    const { startSubscription } = createWoowtechPushSubscriptions(phone.dependencies);

    startSubscription({ client, serverId: SERVER_ID });
    client.connect();
    await settle();

    expect(client.received).toEqual(["revoke ExponentPushToken[old-test-build]"]);
    expect(phone.storage.has(CACHE_KEY)).toBe(false);
    expect(phone.events).toEqual(["disableExpoServerRegistration"]);
  });

  it("keeps the cached string for a daemon that can neither relay pushes nor revoke tokens", async () => {
    const phone = createPhone();
    phone.storage.set(CACHE_KEY, "ExponentPushToken[old-test-build]");
    const client = new FakeDaemonClient({});
    const { startSubscription } = createWoowtechPushSubscriptions(phone.dependencies);

    startSubscription({ client, serverId: SERVER_ID });
    client.connect();
    await settle();

    expect(client.received).toEqual([]);
    expect(phone.storage.get(CACHE_KEY)).toBe("ExponentPushToken[old-test-build]");
  });

  it("registers wsp1:<language>:<FCM token> with a woowtech daemon, cached under upstream's key", async () => {
    const phone = createPhone();
    const client = new FakeDaemonClient(WOOWTECH_DAEMON);
    const { startSubscription } = createWoowtechPushSubscriptions(phone.dependencies);

    startSubscription({ client, serverId: SERVER_ID });
    client.connect();
    await settle();

    expect(client.registered).toEqual([`wsp1:zh-TW:${FCM_TOKEN}`]);
    expect(phone.storage.get(CACHE_KEY)).toBe(`wsp1:zh-TW:${FCM_TOKEN}`);
    expect(phone.events).toEqual([
      "disableExpoServerRegistration",
      "permission(mayAsk=true)",
      "channel",
      "getToken",
      "onTokenRefresh",
    ]);
  });

  it("revokes the string cached for the daemon, such as an old Expo token, before registering", async () => {
    const phone = createPhone();
    phone.storage.set(CACHE_KEY, "ExponentPushToken[old-test-build]");
    const client = new FakeDaemonClient(WOOWTECH_DAEMON);
    const { startSubscription } = createWoowtechPushSubscriptions(phone.dependencies);

    startSubscription({ client, serverId: SERVER_ID });
    client.connect();
    await settle();

    expect(client.received).toEqual([
      "revoke ExponentPushToken[old-test-build]",
      `register wsp1:zh-TW:${FCM_TOKEN}`,
    ]);
    expect(phone.storage.get(CACHE_KEY)).toBe(`wsp1:zh-TW:${FCM_TOKEN}`);
  });

  it("registers again on every reconnect, which renews the daemon's 48-hour lease", async () => {
    const phone = createPhone();
    const client = new FakeDaemonClient(WOOWTECH_DAEMON);
    const { startSubscription } = createWoowtechPushSubscriptions(phone.dependencies);

    startSubscription({ client, serverId: SERVER_ID });
    client.connect();
    await settle();
    client.disconnect();
    client.connect();
    await settle();

    expect(client.received).toEqual([
      `register wsp1:zh-TW:${FCM_TOKEN}`,
      `register wsp1:zh-TW:${FCM_TOKEN}`,
    ]);
    // The user is asked at most once per subscription.
    expect(phone.events.filter((event) => event.startsWith("permission"))).toEqual([
      "permission(mayAsk=true)",
      "permission(mayAsk=false)",
    ]);
  });

  it("moves the registration to a refreshed FCM token", async () => {
    const phone = createPhone();
    const client = new FakeDaemonClient(WOOWTECH_DAEMON);
    const { startSubscription } = createWoowtechPushSubscriptions(phone.dependencies);

    startSubscription({ client, serverId: SERVER_ID });
    client.connect();
    await settle();
    phone.refreshFcmToken("dGVzdC1pbnN0YWxsYXRpb24:APA91bH-refreshed_token");
    await settle();

    expect(client.received).toEqual([
      `register wsp1:zh-TW:${FCM_TOKEN}`,
      `revoke wsp1:zh-TW:${FCM_TOKEN}`,
      "register wsp1:zh-TW:dGVzdC1pbnN0YWxsYXRpb24:APA91bH-refreshed_token",
    ]);
    expect(phone.storage.get(CACHE_KEY)).toBe(
      "wsp1:zh-TW:dGVzdC1pbnN0YWxsYXRpb24:APA91bH-refreshed_token",
    );
  });

  it.each([
    { eventArrives: "after", newTokenRegistrations: 1 },
    { eventArrives: "before", newTokenRegistrations: 2 },
  ] as const)(
    "registers once per connection on Android, where getting the token also reports it as new (event $eventArrives the token)",
    async ({ eventArrives, newTokenRegistrations }) => {
      const phone = createPhone();
      let fcmToken = FCM_TOKEN;
      const expoNotifications = androidExpoNotifications(() => fcmToken, eventArrives);
      const { startSubscription } = createWoowtechPushSubscriptions({
        ...phone.dependencies,
        fcmTokens: createAndroidFcmTokenSource(
          () => expoNotifications,
          () => undefined,
        ),
      });
      const client = new FakeDaemonClient(WOOWTECH_DAEMON);

      startSubscription({ client, serverId: SERVER_ID });
      client.connect();
      await settleTurns(10);
      expect(client.received).toEqual([`register wsp1:zh-TW:${FCM_TOKEN}`]);

      client.disconnect();
      client.connect();
      await settleTurns(10);
      expect(client.received).toEqual([
        `register wsp1:zh-TW:${FCM_TOKEN}`,
        `register wsp1:zh-TW:${FCM_TOKEN}`,
      ]);

      // A token Firebase really replaced still moves the registration, and then it rests. When
      // the new token's event comes first, it asks for one more sync, which registers the same
      // string again.
      fcmToken = "dGVzdC1pbnN0YWxsYXRpb24:APA91bH-refreshed_token";
      phone.changeLanguage("en");
      await settleTurns(20);
      expect(client.received.slice(2)).toEqual([
        `revoke wsp1:zh-TW:${FCM_TOKEN}`,
        ...Array.from({ length: newTokenRegistrations }, () => `register wsp1:en:${fcmToken}`),
      ]);
      expect(phone.storage.get(CACHE_KEY)).toBe(`wsp1:en:${fcmToken}`);
    },
  );

  it("moves the registration to English when the app switches to English", async () => {
    const phone = createPhone();
    const client = new FakeDaemonClient(WOOWTECH_DAEMON);
    const { startSubscription } = createWoowtechPushSubscriptions(phone.dependencies);

    startSubscription({ client, serverId: SERVER_ID });
    client.connect();
    await settle();
    phone.changeLanguage("en");
    await settle();

    expect(client.received).toEqual([
      `register wsp1:zh-TW:${FCM_TOKEN}`,
      `revoke wsp1:zh-TW:${FCM_TOKEN}`,
      `register wsp1:en:${FCM_TOKEN}`,
    ]);
    expect(phone.storage.get(CACHE_KEY)).toBe(`wsp1:en:${FCM_TOKEN}`);
  });

  it("keeps the registration when the new language gets pushes in the same language", async () => {
    const phone = createPhone();
    const client = new FakeDaemonClient(WOOWTECH_DAEMON);
    const { startSubscription } = createWoowtechPushSubscriptions(phone.dependencies);

    startSubscription({ client, serverId: SERVER_ID });
    client.connect();
    await settle();
    phone.changeLanguage("zh-CN");
    await settle();

    expect(client.revoked).toEqual([]);
    expect(phone.storage.get(CACHE_KEY)).toBe(`wsp1:zh-TW:${FCM_TOKEN}`);
  });

  it("revokes the cached string and forgets it when notifications are not allowed", async () => {
    const phone = createPhone({ permission: false });
    phone.storage.set(CACHE_KEY, `wsp1:zh-TW:${FCM_TOKEN}`);
    const client = new FakeDaemonClient(WOOWTECH_DAEMON);
    const { startSubscription } = createWoowtechPushSubscriptions(phone.dependencies);

    startSubscription({ client, serverId: SERVER_ID });
    client.connect();
    await settle();

    expect(client.received).toEqual([`revoke wsp1:zh-TW:${FCM_TOKEN}`]);
    expect(phone.storage.has(CACHE_KEY)).toBe(false);
    expect(phone.events).not.toContain("getToken");
  });

  it("registers nothing without an FCM token, as in a build without Firebase files", async () => {
    const phone = createPhone({ fcmToken: null });
    phone.storage.set(CACHE_KEY, "ExponentPushToken[old-test-build]");
    const client = new FakeDaemonClient(WOOWTECH_DAEMON);
    const { startSubscription } = createWoowtechPushSubscriptions(phone.dependencies);

    startSubscription({ client, serverId: SERVER_ID });
    client.connect();
    await settle();

    expect(client.received).toEqual([]);
    expect(phone.refreshListenerCount()).toBe(0);
  });

  it("registers nothing for an FCM token outside the relay's contract, and never logs it", async () => {
    const phone = createPhone({ fcmToken: "no-colon-in-this-token-at-all" });
    const warnings: unknown[] = [];
    const { startSubscription } = createWoowtechPushSubscriptions({
      ...phone.dependencies,
      warn: (...args) => warnings.push(...args),
    });
    const client = new FakeDaemonClient(WOOWTECH_DAEMON);

    startSubscription({ client, serverId: SERVER_ID });
    client.connect();
    await settle();

    expect(client.received).toEqual([]);
    expect(warnings).toEqual([
      "[PushNotifications] The FCM token (29 characters) is outside the push relay's contract",
    ]);
  });

  it("moves the registration on every daemon at once on iOS, where one APNs registration supersedes another", async () => {
    // React Native Firebase (26.4) rejects a pending registerDeviceForRemoteMessages with
    // registration-superseded when another starts before UIKit answers.
    let pendingRegistration: ((error: Error) => void) | null = null;
    const rnFirebase: RnFirebaseMessaging<"messaging"> = {
      getMessaging: () => "messaging",
      registerDeviceForRemoteMessages: () =>
        new Promise<void>((resolve, reject) => {
          pendingRegistration?.(
            Object.assign(new Error("[messaging/registration-superseded]"), {
              code: "messaging/registration-superseded",
            }),
          );
          pendingRegistration = reject;
          setImmediate(() => {
            if (pendingRegistration !== reject) return;
            pendingRegistration = null;
            resolve();
          });
        }),
      getAPNSToken: async () => "3f0e5a9c1b2d4e6f8a0b1c2d3e4f5a6b",
      getToken: async () => FCM_TOKEN,
      onTokenRefresh: () => () => undefined,
    };
    const phone = createPhone();
    const { startSubscription } = createWoowtechPushSubscriptions({
      ...phone.dependencies,
      fcmTokens: createIosFcmTokenSource({
        loadMessaging: () => rnFirebase,
        loadApnsRegistration: () => async () => undefined,
        warn: () => undefined,
      }),
    });
    const daemons = [new FakeDaemonClient(WOOWTECH_DAEMON), new FakeDaemonClient(WOOWTECH_DAEMON)];
    daemons.forEach((client, index) =>
      startSubscription({ client, serverId: `${SERVER_ID.slice(0, -1)}${index}` }),
    );
    for (const client of daemons) client.connect();
    await settleTurns(5);

    phone.changeLanguage("en");
    await settleTurns(5);

    for (const client of daemons) {
      expect(client.received).toEqual([
        `register wsp1:zh-TW:${FCM_TOKEN}`,
        `revoke wsp1:zh-TW:${FCM_TOKEN}`,
        `register wsp1:en:${FCM_TOKEN}`,
      ]);
    }
  });

  it("stops following the daemon, token refreshes and the language once stopped", async () => {
    const phone = createPhone();
    const client = new FakeDaemonClient(WOOWTECH_DAEMON);
    const { startSubscription } = createWoowtechPushSubscriptions(phone.dependencies);

    const stop = startSubscription({ client, serverId: SERVER_ID });
    client.connect();
    await settle();
    stop();
    client.disconnect();
    client.connect();
    phone.changeLanguage("en");
    await settle();

    expect(client.received).toEqual([`register wsp1:zh-TW:${FCM_TOKEN}`]);
    expect(phone.refreshListenerCount()).toBe(0);
  });

  it("registers nothing and follows nothing when stopped while the FCM token is on its way", async () => {
    const phone = createPhone();
    let deliverToken: (token: string) => void = () => undefined;
    const { startSubscription } = createWoowtechPushSubscriptions({
      ...phone.dependencies,
      fcmTokens: {
        ...phone.dependencies.fcmTokens,
        getToken: () => new Promise<string>((resolve) => (deliverToken = resolve)),
      },
    });
    const client = new FakeDaemonClient(WOOWTECH_DAEMON);

    const stop = startSubscription({ client, serverId: SERVER_ID });
    client.connect();
    await settle();
    stop();
    deliverToken(FCM_TOKEN);
    await settle();

    expect(client.received).toEqual([]);
    expect(phone.refreshListenerCount()).toBe(0);
    expect(phone.storage.has(CACHE_KEY)).toBe(false);
  });
});

describe("Expo's own push registration", () => {
  it("is turned off at app start, with no host yet, and no subscription turns it off again", async () => {
    const phone = createPhone();
    const { startSubscription, turnOffExpoPushRegistration } = createWoowtechPushSubscriptions(
      phone.dependencies,
    );

    await turnOffExpoPushRegistration();
    expect(phone.events).toEqual(["disableExpoServerRegistration"]);

    const client = new FakeDaemonClient(WOOWTECH_DAEMON);
    startSubscription({ client, serverId: SERVER_ID });
    client.connect();
    await settle();
    expect(phone.events.filter((event) => event === "disableExpoServerRegistration")).toEqual([
      "disableExpoServerRegistration",
    ]);
    expect(client.registered).toEqual([`wsp1:zh-TW:${FCM_TOKEN}`]);
  });

  it("is turned off exactly once per app run, before any daemon connects", async () => {
    const phone = createPhone();
    const { startSubscription } = createWoowtechPushSubscriptions(phone.dependencies);
    const woowtechDaemon = new FakeDaemonClient(WOOWTECH_DAEMON);
    const paseoDaemon = new FakeDaemonClient(PASEO_DAEMON);

    startSubscription({ client: woowtechDaemon, serverId: SERVER_ID });
    startSubscription({ client: paseoDaemon, serverId: "srv_0123456789ab" });
    await settle();
    expect(phone.events).toEqual(["disableExpoServerRegistration"]);

    woowtechDaemon.connect();
    paseoDaemon.connect();
    woowtechDaemon.disconnect();
    woowtechDaemon.connect();
    await settle();
    expect(phone.events.filter((event) => event === "disableExpoServerRegistration")).toEqual([
      "disableExpoServerRegistration",
    ]);
  });

  it("cannot break starting a subscription, even when turning it off throws at once", async () => {
    const phone = createPhone();
    const { startSubscription } = createWoowtechPushSubscriptions({
      ...phone.dependencies,
      disableExpoServerRegistration: () => {
        throw new TypeError("setAutoServerRegistrationEnabledAsync is not a function");
      },
    });
    const client = new FakeDaemonClient(WOOWTECH_DAEMON);

    expect(() => startSubscription({ client, serverId: SERVER_ID })).not.toThrow();
    client.connect();
    await settle();

    expect(client.registered).toEqual([`wsp1:zh-TW:${FCM_TOKEN}`]);
  });

  it("does not stop the registration when it cannot be turned off", async () => {
    const phone = createPhone();
    const warnings: string[] = [];
    const { startSubscription } = createWoowtechPushSubscriptions({
      ...phone.dependencies,
      // The F-Droid build's expo-notifications stub has no setAutoServerRegistrationEnabledAsync.
      disableExpoServerRegistration: async () => {
        throw new TypeError("setAutoServerRegistrationEnabledAsync is not a function");
      },
      warn: (message) => warnings.push(message),
    });
    const client = new FakeDaemonClient(WOOWTECH_DAEMON);

    startSubscription({ client, serverId: SERVER_ID });
    client.connect();
    await settle();

    expect(client.registered).toEqual([`wsp1:zh-TW:${FCM_TOKEN}`]);
    expect(warnings).toEqual(["[PushNotifications] Failed to turn off Expo push registration"]);
  });
});

describe("revoking woowtech push for a removed host", () => {
  it("revokes the cached string from a connected daemon, then forgets it", async () => {
    const phone = createPhone();
    phone.storage.set(CACHE_KEY, `wsp1:zh-TW:${FCM_TOKEN}`);
    const client = new FakeDaemonClient(WOOWTECH_DAEMON);
    client.connect();
    const { revokeSubscription } = createWoowtechPushSubscriptions(phone.dependencies);

    await revokeSubscription({ client, serverId: SERVER_ID });

    expect(client.revoked).toEqual([`wsp1:zh-TW:${FCM_TOKEN}`]);
    expect(phone.storage.has(CACHE_KEY)).toBe(false);
  });

  it("only forgets it without a connected daemon that supports revocation", async () => {
    const phone = createPhone();
    const { revokeSubscription } = createWoowtechPushSubscriptions(phone.dependencies);
    const disconnected = new FakeDaemonClient(WOOWTECH_DAEMON);
    const withoutRevocation = new FakeDaemonClient({ woowtechPush: true });
    withoutRevocation.connect();

    for (const client of [null, disconnected, withoutRevocation]) {
      phone.storage.set(CACHE_KEY, `wsp1:zh-TW:${FCM_TOKEN}`);
      await revokeSubscription({ client, serverId: SERVER_ID });
      expect(phone.storage.has(CACHE_KEY)).toBe(false);
    }
    expect(disconnected.revoked).toEqual([]);
    expect(withoutRevocation.revoked).toEqual([]);
  });

  it("still forgets it when the daemon fails to revoke", async () => {
    const phone = createPhone();
    phone.storage.set(CACHE_KEY, `wsp1:zh-TW:${FCM_TOKEN}`);
    const client = new FakeDaemonClient(WOOWTECH_DAEMON);
    client.connect();
    client.revocationError = new Error("push.unregister.request timed out");
    const { revokeSubscription } = createWoowtechPushSubscriptions(phone.dependencies);

    await revokeSubscription({ client, serverId: SERVER_ID });

    expect(phone.storage.has(CACHE_KEY)).toBe(false);
  });
});
