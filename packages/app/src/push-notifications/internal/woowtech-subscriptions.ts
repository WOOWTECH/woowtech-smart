import AsyncStorage from "@react-native-async-storage/async-storage";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { encodePushToken, isFcmToken, pushLocaleFor } from "@getpaseo/protocol/woowtech-push";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  normalizeNotificationPreferences,
  type NotificationPreferences,
} from "@getpaseo/protocol/notification-preferences";
import type * as ExpoNotifications from "expo-notifications";
import { Platform } from "react-native";
import { z } from "zod";
import { queryClient } from "@/data/query-client";
import { APP_SETTINGS_QUERY_KEY, type AppSettings } from "@/hooks/use-settings/storage";
import { i18n } from "@/i18n/i18next";
import { readValidatedString } from "@/storage/validated-storage";
import { fcmTokenSource } from "./fcm-token";
import type { FcmTokenSource } from "./fcm-token-source";
import { disableIosExpoRegistration } from "./woowtech-expo-registration";
import {
  setAndroidNotificationChannels,
  woowtechNotificationChannels,
  type WoowtechNotificationChannel,
} from "./woowtech-notification-channels";

// woowtech smart push (fork-owned; woowtech/README.md, 16). Replaces upstream's subscriptions.ts,
// which registered an Expo push token with any daemon: the app registers
// "wsp1:<zh-TW|en>:<FCM token>" only with a daemon that pushes through WoowTech's relay. Like
// upstream's, the registration carries the device's notification settings to a daemon that filters
// pushes by them (v0.18), and moves when they change.

/** The daemon connection a push subscription uses. */
export type PushDaemonClient = Pick<
  DaemonClient,
  | "isConnected"
  | "subscribeConnectionStatus"
  | "getLastServerInfoMessage"
  | "registerPushToken"
  | "unregisterPushToken"
>;

/** What revoking uses, as upstream's RevokePushNotificationsInput. */
export type RevokeDaemonClient = Pick<
  PushDaemonClient,
  "isConnected" | "getLastServerInfoMessage" | "unregisterPushToken"
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

export interface NotificationPreferencesSource {
  /** The device's notification settings: the cached app settings at once, else from storage. */
  resolve(): Promise<NotificationPreferences>;
  /** Called whenever the app settings change, with the notification part of them. */
  subscribe(listener: (preferences: NotificationPreferences) => void): () => void;
}

export interface WoowtechPushDependencies {
  storage: PushTokenStorage;
  /** Whether the app may notify. Asks the user only when `mayAsk` and the OS still allows it. */
  notificationPermission(options: { mayAsk: boolean }): Promise<boolean>;
  /** Creates or renames the Android channels the relay's pushes name. Nothing on iOS. */
  setNotificationChannels(channels: readonly WoowtechNotificationChannel[]): Promise<void>;
  fcmTokens: FcmTokenSource;
  appLanguage: AppLanguage;
  notificationPreferences: NotificationPreferencesSource;
  /** Persist disabled Expo registration; iOS requires a non-null native String. */
  disableExpoServerRegistration(): Promise<void>;
  warn(message: string, error?: unknown): void;
}

export interface StartWoowtechPushInput {
  client: PushDaemonClient;
  serverId: string;
}

export interface RevokeWoowtechPushInput {
  client: RevokeDaemonClient | null;
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
  async function revokeFromDaemon(client: RevokeDaemonClient | null, token: string): Promise<void> {
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

  async function forgetCachedToken(client: RevokeDaemonClient | null, key: string): Promise<void> {
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
    /** The settings the daemon last received, while it filters pushes by them. */
    let registeredPreferences: string | null = null;
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
      // woowtech smart: the channels come before the question. Android 13 and later shows its
      // notification prompt only once the app has a channel, so asking first got a fresh install
      // no prompt at all, and no pushes (Expo's notifications guide, "Permissions > Android").
      // Named in the app's language, like the relay's text: a new language renames them.
      await dependencies.setNotificationChannels(
        woowtechNotificationChannels(dependencies.appLanguage.current()),
      );
      const mayAsk = !askedPermission;
      askedPermission = true;
      if (!(await dependencies.notificationPermission({ mayAsk }))) {
        // Upstream only forgot the token; the daemon kept pushing to it.
        await forgetCachedToken(client, key);
        return;
      }
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
      const preferences = await dependencies.notificationPreferences.resolve();
      if (stopped || !client.isConnected) return;
      // COMPAT(pushNotificationPreferences): added in v0.18.0, remove gate after 2027-06-01.
      // An older daemon keeps its own filter; its relay pushes include an agent's error.
      if (client.getLastServerInfoMessage()?.features?.pushNotificationPreferences === true) {
        client.registerPushToken(token, preferences);
        registeredPreferences = JSON.stringify(preferences);
      } else {
        client.registerPushToken(token);
        registeredPreferences = null;
      }
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
    // Other app settings change too; only new notification settings move the registration.
    const unsubscribePreferences = dependencies.notificationPreferences.subscribe((preferences) => {
      if (registeredPreferences !== null && JSON.stringify(preferences) !== registeredPreferences) {
        scheduleSync();
      }
    });
    return () => {
      stopped = true;
      unsubscribeConnection();
      unsubscribeLanguage();
      unsubscribePreferences();
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

function cachedNotificationPreferences(): NotificationPreferences | null {
  const cached = queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY);
  return cached ? normalizeNotificationPreferences(cached.notifications) : null;
}

// As upstream's subscriptions.ts: the app settings query, or storage before the app has read it.
const appNotificationPreferences: NotificationPreferencesSource = {
  async resolve() {
    const cached = cachedNotificationPreferences();
    if (cached) return cached;
    try {
      const { loadAppSettingsFromStorage } = await import("@/hooks/use-settings");
      return normalizeNotificationPreferences((await loadAppSettingsFromStorage()).notifications);
    } catch {
      return DEFAULT_NOTIFICATION_PREFERENCES;
    }
  },
  subscribe(listener) {
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] !== APP_SETTINGS_QUERY_KEY[0]) return;
      const preferences = cachedNotificationPreferences();
      if (preferences) listener(preferences);
    });
  },
};

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
  // The first channel, "default", is no longer created and not yet deleted: until the relay names
  // the new channels, phones that have it keep getting pushes in it (woowtech/README.md, 16).
  async setNotificationChannels(channels) {
    if (Platform.OS !== "android") return;
    await setAndroidNotificationChannels(expoNotifications(), channels);
  },
  fcmTokens: fcmTokenSource,
  notificationPreferences: appNotificationPreferences,
  appLanguage: {
    current: () => i18n.language,
    subscribe(listener) {
      i18n.on("languageChanged", listener);
      return () => i18n.off("languageChanged", listener);
    },
  },
  async disableExpoServerRegistration() {
    if (Platform.OS === "ios") {
      await disableIosExpoRegistration();
      return;
    }
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
