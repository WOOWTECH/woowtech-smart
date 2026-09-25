import {
  revokeSubscription,
  startSubscription,
  turnOffExpoPushRegistration,
} from "./internal/woowtech-subscriptions";
import type { RevokePushNotificationsInput, StartPushNotificationsInput } from "./internal/types";

// woowtech smart: at app start, with or without hosts (woowtech/README.md, 16).
void turnOffExpoPushRegistration();

export function startPushNotifications(input: StartPushNotificationsInput): () => void {
  return startSubscription(input);
}

export function revokePushNotifications(input: RevokePushNotificationsInput): Promise<void> {
  return revokeSubscription(input).catch((error) => {
    console.warn("[PushNotifications] Failed to remove local push subscription", error);
  });
}
