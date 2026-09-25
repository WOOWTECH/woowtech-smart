import AsyncStorage from "@react-native-async-storage/async-storage";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { encodePushToken, isFcmToken, pushLocaleFor } from "@getpaseo/protocol/woowtech-push";
import type * as ExpoNotifications from "expo-notifications";
import { Platform } from "react-native";
import { z } from "zod";
import { i18n } from "@/i18n/i18next";
import { readValidatedString } from "@/storage/validated-storage";
import { fcmTokenSource } from "./fcm-token";
import type { FcmTokenSource } from "./fcm-token-source";

// woowtech smart push (fork-owned; woowtech/README.md, 16). Replaces upstream's subscriptions.ts,
// which registered an Expo push token with any daemon: the app registers
// "wsp1:<zh-TW|en>:<FCM token>" only with a daemon that pushes through WoowTech's relay.

/** The daemon connection a push subscription uses. */
export type PushDaemonClient = Pick<
  DaemonClient,
  | "isConnected"
  | "subscribeConnectionStatus"
  | "getLastServerInfoMessage"
  | "registerPushToken"
  | "unregisterPushToken"
>;

export interface PushTokenStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface AppLanguage {
  /** The app's language (i18next), such as "zh-TW" or "en". */
  current(): string;
  subscribe(listener: (language: string) => void): () => void;
}

export interface WoowtechPushDependencies {
  storage: PushTokenStorage;
  /** Whether the app may notify. Asks the user only when `mayAsk` and the OS still allows it. */
  notificationPermission(options: { mayAsk: boolean }): Promise<boolean>;
  /** Android's "default" channel, which the relay's pushes name. Nothing on iOS. */
  prepareNotificationChannel(): Promise<void>;
  fcmTokens: FcmTokenSource;
  appLanguage: AppLanguage;
  /** expo-notifications' setAutoServerRegistrationEnabledAsync(false). */
  disableExpoServerRegistration(): Promise<void>;
  warn(message: string, error?: unknown): void;
}

export interface StartWoowtechPushInput {
  client: PushDaemonClient;
  serverId: string;
}

export interface RevokeWoowtechPushInput {
  client: PushDaemonClient | null;
  serverId: string;
}

// Upstream's key for the Expo push token: the first sync after an update finds the old Expo token
// there and revokes it from the daemon.
const STORAGE_PREFIX = "@paseo:expo-push-token:";

const CachedTokenSchema = z.string().trim().min(1);

function storageKey(serverId: string): string {
  return `${STORAGE_PREFIX}${serverId}`;
}

export function createWoowtechPushSubscriptions(dependencies: WoowtechPushDependencies) {
  let expoRegistrationDisabled: Promise<void> | null = null;

  // An older build that fetched an Expo push token left expo-notifications uploading the device
  // token to Expo at every launch; turn that off once per app run.
  function disableExpoRegistrationOnce(): Promise<void> {
    // Runs inside a promise: a throw must never escape startSubscription, a React effect.
    expoRegistrationDisabled ??= Promise.resolve()
      .then(() => dependencies.disableExpoServerRegistration())
      .catch((error) =>
        dependencies.warn("[PushNotifications] Failed to turn off Expo push registration", error),
      );
    return expoRegistrationDisabled;
  }

  // As upstream: only a connected daemon that supports revocation can revoke.
  async function revokeFromDaemon(client: PushDaemonClient | null, token: string): Promise<void> {
    if (
      !client?.isConnected ||
      client.getLastServerInfoMessage()?.features?.pushTokenRevocation !== true
    ) {
      return;
    }
    try {
      await client.unregisterPushToken(token);
    } catch (error) {
      dependencies.warn("[PushNotifications] Failed to revoke push token", error);
    }
  }

  async function forgetCachedToken(client: PushDaemonClient | null, key: string): Promise<void> {
    const cached = await readValidatedString(dependencies.storage, key, CachedTokenSchema);
    if (cached) await revokeFromDaemon(client, cached);
    await dependencies.storage.removeItem(key);
  }

  function startSubscription(input: StartWoowtechPushInput): () => void {
    const { client } = input;
    const key = storageKey(input.serverId);
    let stopped = false;
    let askedPermission = false;
    let stopFollowingRefreshes: (() => void) | null = null;
    let lastFcmToken: string | null = null;
    let queue: Promise<void> = Promise.resolve();

    async function sync(): Promise<void> {
      await disableExpoRegistrationOnce();
      if (stopped || !client.isConnected) return;
      const features = client.getLastServerInfoMessage()?.features;
      if (features?.woowtechPush !== true) {
        // Such a daemon pushes to Expo with the agent's reply: revoke the Expo token an older
        // build registered with it. No permission prompt, no Firebase.
        if (features?.pushTokenRevocation === true) await forgetCachedToken(client, key);
        return;
      }
      const mayAsk = !askedPermission;
      askedPermission = true;
      if (!(await dependencies.notificationPermission({ mayAsk }))) {
        // Upstream only forgot the token; the daemon kept pushing to it.
        await forgetCachedToken(client, key);
        return;
      }
      await dependencies.prepareNotificationChannel();
      const fcmToken = await dependencies.fcmTokens.getToken();
      if (stopped || !fcmToken) return;
      if (!isFcmToken(fcmToken)) {
        // The relay would refuse it. Say so without logging the token.
        dependencies.warn(
          `[PushNotifications] The FCM token (${fcmToken.length} characters) is outside the push relay's contract`,
        );
        return;
      }
      // Firebase can replace the token at any time; follow it once the phone has one. Only a
      // different token counts: on Android, expo-notifications reports every token it hands out as
      // a new one (PushTokenModule.kt), and syncing on that would get the token again, forever.
      lastFcmToken = fcmToken;
      stopFollowingRefreshes ??= dependencies.fcmTokens.onTokenRefresh((refreshed) => {
        if (refreshed !== lastFcmToken) scheduleSync();
      });
      const token = encodePushToken({
        locale: pushLocaleFor(dependencies.appLanguage.current()),
        fcmToken,
      });
      const cached = await readValidatedString(dependencies.storage, key, CachedTokenSchema);
      // One string per phone and daemon, or the phone would get every push twice.
      if (cached && cached !== token) await revokeFromDaemon(client, cached);
      if (stopped || !client.isConnected) return;
      client.registerPushToken(token);
      await dependencies.storage.setItem(key, token);
    }

    function scheduleSync(): void {
      queue = queue
        .then(sync)
        .catch((error) =>
          dependencies.warn("[PushNotifications] Failed to register push token", error),
        );
    }

    void disableExpoRegistrationOnce();
    const unsubscribeConnection = client.subscribeConnectionStatus((state) => {
      if (state.status === "connected") scheduleSync();
    });
    // The relay writes in the app's language, so a new language moves the registration.
    const unsubscribeLanguage = dependencies.appLanguage.subscribe(() => scheduleSync());
    return () => {
      stopped = true;
      unsubscribeConnection();
      unsubscribeLanguage();
      stopFollowingRefreshes?.();
    };
  }

  // Removing a host: as upstream, revoke from a daemon that can, and always forget the string.
  async function revokeSubscription(input: RevokeWoowtechPushInput): Promise<void> {
    await forgetCachedToken(input.client, storageKey(input.serverId));
  }

  return {
    startSubscription,
    revokeSubscription,
    /** At app start, with or without hosts; every subscription waits for the same call. */
    turnOffExpoPushRegistration: disableExpoRegistrationOnce,
  };
}

// Loaded on first use: the unit tests cannot import expo-notifications, and F-Droid builds swap in
// a stub without setAutoServerRegistrationEnabledAsync (metro.config.cjs).
function expoNotifications(): typeof ExpoNotifications {
  return require("expo-notifications");
}

const nativeDependencies: WoowtechPushDependencies = {
  storage: AsyncStorage,
  // As upstream's subscriptions.ts.
  async notificationPermission({ mayAsk }) {
    const Notifications = expoNotifications();
    const existing = await Notifications.getPermissionsAsync();
    if (existing.status === Notifications.PermissionStatus.GRANTED) return true;
    if (!mayAsk || !existing.canAskAgain) return false;
    const requested = await Notifications.requestPermissionsAsync();
    return requested.status === Notifications.PermissionStatus.GRANTED;
  },
  async prepareNotificationChannel() {
    if (Platform.OS !== "android") return;
    const Notifications = expoNotifications();
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  },
  fcmTokens: fcmTokenSource,
  appLanguage: {
    current: () => i18n.language,
    subscribe(listener) {
      i18n.on("languageChanged", listener);
      return () => i18n.off("languageChanged", listener);
    },
  },
  async disableExpoServerRegistration() {
    await expoNotifications().setAutoServerRegistrationEnabledAsync(false);
  },
  warn(message, error) {
    if (error === undefined) console.warn(message);
    else console.warn(message, error);
  },
};

const nativeSubscriptions = createWoowtechPushSubscriptions(nativeDependencies);

/** Named as in upstream's subscriptions.ts, so index.native.ts changes only its import. */
export const startSubscription = nativeSubscriptions.startSubscription;
export const revokeSubscription = nativeSubscriptions.revokeSubscription;
/** index.native.ts calls this when it loads: the app starts, whether or not it has hosts. */
export const turnOffExpoPushRegistration = nativeSubscriptions.turnOffExpoPushRegistration;
