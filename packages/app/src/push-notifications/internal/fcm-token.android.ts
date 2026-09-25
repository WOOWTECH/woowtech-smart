import type * as ExpoNotifications from "expo-notifications";
import type { FcmTokenSource } from "./fcm-token-source";

/** The expo-notifications functions the Android token needs. */
export type ExpoPushTokens = Pick<
  typeof ExpoNotifications,
  "getDevicePushTokenAsync" | "addPushTokenListener"
>;

type Warn = (message: string, error?: unknown) => void;

function tokenString(data: unknown): string | null {
  return typeof data === "string" && data.length > 0 ? data : null;
}

export function createAndroidFcmTokenSource(
  loadNotifications: () => ExpoPushTokens,
  warn: Warn = console.warn,
): FcmTokenSource {
  return {
    async getToken() {
      try {
        // On Android the device push token is the FCM registration token. Without
        // google-services.json Firebase is not initialized and this rejects.
        const token = await loadNotifications().getDevicePushTokenAsync();
        return tokenString(token.data);
      } catch (error) {
        warn("[PushNotifications] No FCM token on this device", error);
        return null;
      }
    },
    onTokenRefresh(listener) {
      try {
        const subscription = loadNotifications().addPushTokenListener((token) => {
          const fcmToken = tokenString(token.data);
          if (fcmToken) listener(fcmToken);
        });
        return () => subscription.remove();
      } catch (error) {
        warn("[PushNotifications] Cannot follow FCM token refreshes on this device", error);
        return () => undefined;
      }
    },
  };
}

// Loaded on first use, like the iOS token: F-Droid builds swap in a stub without push tokens
// (metro.config.cjs), and the unit tests cannot import expo-notifications.
function loadExpoNotifications(): ExpoPushTokens {
  const notifications: typeof ExpoNotifications = require("expo-notifications");
  return notifications;
}

export const fcmTokenSource: FcmTokenSource = createAndroidFcmTokenSource(loadExpoNotifications);
