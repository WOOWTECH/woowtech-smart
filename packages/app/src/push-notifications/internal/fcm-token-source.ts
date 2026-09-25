/**
 * Where this phone's FCM registration token comes from (woowtech smart push, fork-owned):
 * React Native Firebase on iOS, expo-notifications on Android, nowhere on other platforms.
 * Metro picks fcm-token.ios.ts, fcm-token.android.ts or fcm-token.ts by platform.
 *
 * Neither method throws: a build without Firebase files, or a platform without FCM, has no token.
 */
export interface FcmTokenSource {
  /** The current FCM token, or null when this build or device cannot get one. */
  getToken(): Promise<string | null>;
  /** Calls `listener` with each new FCM token, and returns the unsubscribe. */
  onTokenRefresh(listener: (token: string) => void): () => void;
}
