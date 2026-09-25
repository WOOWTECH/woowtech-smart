import type { Messaging } from "@react-native-firebase/messaging";
import type { FcmTokenSource } from "./fcm-token-source";

/** The part of @react-native-firebase/messaging's modular API (26.x) the iOS token needs. */
export interface RnFirebaseMessaging<Handle = Messaging> {
  getMessaging(): Handle;
  registerDeviceForRemoteMessages(messaging: Handle): Promise<void>;
  getAPNSToken(messaging: Handle): Promise<string | null>;
  getToken(messaging: Handle): Promise<string>;
  onTokenRefresh(messaging: Handle, listener: (token: string) => void): () => void;
}

type Warn = (message: string, error?: unknown) => void;

export interface IosFcmTokenSourceOptions<Handle> {
  loadMessaging: () => RnFirebaseMessaging<Handle>;
  /** UIKit's registerForRemoteNotifications, settled once iOS hands over the APNs token. */
  loadApnsRegistration: () => () => Promise<unknown>;
  warn?: Warn;
  sleep?: (ms: number) => Promise<void>;
}

// How long iOS gets to hand over the APNs token, as long as React Native Firebase waits for its
// own registration.
const APNS_WAIT_MS = 10_000;

// A registration another one took the place of, or one APNs did not answer in time.
const RETRIED_REGISTRATION_ERRORS = new Set([
  "messaging/registration-superseded",
  "messaging/registration-timeout",
]);

class ApnsTimeoutError extends Error {
  readonly code = "push/apns-timeout";

  constructor() {
    super(`iOS did not hand over an APNs token within ${APNS_WAIT_MS} ms`);
    this.name = "ApnsTimeoutError";
  }
}

/** React Native Firebase's error code (messaging/…), or the error's name. */
function errorCodeOf(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error;
    if (typeof code === "string") return code;
  }
  return error instanceof Error ? error.name : "unknown";
}

function sleepFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createIosFcmTokenSource<Handle>(
  options: IosFcmTokenSourceOptions<Handle>,
): FcmTokenSource {
  const warn = options.warn ?? console.warn;
  const sleep = options.sleep ?? sleepFor;
  // One registration and token request at a time: each daemon's subscription asks for the token,
  // often at once (a new language, the first permission prompt), and React Native Firebase rejects
  // a pending registration another call supersedes.
  let inFlight: Promise<string | null> | null = null;

  async function registerDevice(firebase: RnFirebaseMessaging<Handle>, messaging: Handle) {
    try {
      await firebase.registerDeviceForRemoteMessages(messaging);
    } catch (error) {
      if (!RETRIED_REGISTRATION_ERRORS.has(errorCodeOf(error))) throw error;
      await firebase.registerDeviceForRemoteMessages(messaging);
    }
  }

  async function fetchToken(): Promise<string | null> {
    try {
      const firebase = options.loadMessaging();
      const messaging = firebase.getMessaging();
      // firebase.json turns APNs auto-registration off, so the app registers before asking.
      await registerDevice(firebase, messaging);
      // In every launch after the first, iOS says the app is registered already and React Native
      // Firebase returns without asking UIKit, while Firebase keeps the APNs token in memory only:
      // getToken would fail. expo-notifications' getDevicePushTokenAsync always asks UIKit.
      if ((await firebase.getAPNSToken(messaging)) === null) {
        await Promise.race([
          options.loadApnsRegistration()(),
          sleep(APNS_WAIT_MS).then(() => {
            throw new ApnsTimeoutError();
          }),
        ]);
      }
      const token = await firebase.getToken(messaging);
      return token.length > 0 ? token : null;
    } catch (error) {
      warn(`[PushNotifications] No FCM token on this device (${errorCodeOf(error)})`, error);
      return null;
    }
  }

  return {
    getToken() {
      inFlight ??= fetchToken().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    onTokenRefresh(listener) {
      try {
        const firebase = options.loadMessaging();
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

// Loaded on first use too, like everything expo-notifications in the push code.
function loadApnsRegistration(): () => Promise<unknown> {
  const notifications: typeof import("expo-notifications") = require("expo-notifications");
  return notifications.getDevicePushTokenAsync;
}

export const fcmTokenSource: FcmTokenSource = createIosFcmTokenSource({
  loadMessaging: loadRnFirebaseMessaging,
  loadApnsRegistration,
});
