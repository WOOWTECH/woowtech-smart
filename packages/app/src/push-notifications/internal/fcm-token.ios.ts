import type { Messaging } from "@react-native-firebase/messaging";
import type { FcmTokenSource } from "./fcm-token-source";

/** The part of @react-native-firebase/messaging's modular API (26.x) the iOS token needs. */
export interface RnFirebaseMessaging<Handle = Messaging> {
  getMessaging(): Handle;
  registerDeviceForRemoteMessages(messaging: Handle): Promise<void>;
  getToken(messaging: Handle): Promise<string>;
  onTokenRefresh(messaging: Handle, listener: (token: string) => void): () => void;
}

type Warn = (message: string, error?: unknown) => void;

export function createIosFcmTokenSource<Handle>(
  loadMessaging: () => RnFirebaseMessaging<Handle>,
  warn: Warn = console.warn,
): FcmTokenSource {
  return {
    async getToken() {
      try {
        const firebase = loadMessaging();
        const messaging = firebase.getMessaging();
        // firebase.json turns APNs auto-registration off, so the app registers before asking.
        await firebase.registerDeviceForRemoteMessages(messaging);
        const token = await firebase.getToken(messaging);
        return token.length > 0 ? token : null;
      } catch (error) {
        warn("[PushNotifications] No FCM token on this device", error);
        return null;
      }
    },
    onTokenRefresh(listener) {
      try {
        const firebase = loadMessaging();
        const unsubscribe = firebase.onTokenRefresh(firebase.getMessaging(), (token) => {
          if (token.length > 0) listener(token);
        });
        return () => {
          unsubscribe();
        };
      } catch (error) {
        warn("[PushNotifications] Cannot follow FCM token refreshes on this device", error);
        return () => undefined;
      }
    },
  };
}

// Loaded on first use: in a build without a GoogleService-Info.plist the native module is not
// linked (react-native.config.js), and importing @react-native-firebase/messaging throws
// ("Native module RNFBAppModule is not registered"). A static import would crash the app.
function loadRnFirebaseMessaging(): RnFirebaseMessaging {
  const messaging: typeof import("@react-native-firebase/messaging") = require("@react-native-firebase/messaging");
  return messaging;
}

export const fcmTokenSource: FcmTokenSource = createIosFcmTokenSource(loadRnFirebaseMessaging);
