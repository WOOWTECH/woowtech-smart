import type { FcmTokenSource } from "./fcm-token-source";

// woowtech smart push: iOS and Android have their own fcm-token.{ios,android}.ts. Web and the
// desktop app have no FCM token.
export const fcmTokenSource: FcmTokenSource = {
  getToken: async () => null,
  onTokenRefresh: () => () => undefined,
};
