// woowtech smart: hands each tapped notification to the router once per app process
// (woowtech/README.md section 16, RC-I-21c).
//
// expo-notifications keeps the most recent tap for the life of its native module
// (ios/EXNotifications/Notifications/Emitter/EmitterModule.swift, android
// .../emitting/NotificationsEmitter.kt) and the app never cleared it, while PushNotificationRouter
// (app/_layout.tsx) de-duplicated with a useRef that a remount resets. A remount (the root error
// boundary's Reload, a Fast Refresh of the root layout) therefore replayed the last tap and
// navigated back to an agent the user had already left.
//
// The handled deliveries live at module scope, so they survive remounts of the router, and the
// native copy is cleared once handled, so a reload of the JS bundle cannot replay it either.
//
// A delivery is its request identifier plus its date, not the identifier alone. The push relay
// sets apns-collapse-id to the agent id (refs/woowtech-push-relay functions/smart-payload.js) and
// iOS uses the collapse id as the request identifier, so every notification for one agent shares
// an identifier; keyed on it alone, a second notification for an agent already tapped was dropped.
// The date (UNNotification.date on iOS, the FCM sent time on Android, EXNotificationSerializer.m
// and NotificationSerializer.java) tells a new notification from the same one delivered twice.

export interface NotificationResponseLike {
  notification: {
    /** When this delivery arrived; expo-notifications serializes it on both platforms. */
    date: number;
    request: {
      identifier: string;
      content: { data?: unknown };
    };
  };
}

export interface NotificationTapSubscription {
  remove(): void;
}

/** The part of expo-notifications this module uses; fdroid/expo-notifications.ts stubs it. */
export interface NotificationResponseSource {
  getLastNotificationResponse(): NotificationResponseLike | null;
  clearLastNotificationResponse(): void;
  addNotificationResponseReceivedListener(
    listener: (response: NotificationResponseLike) => void,
  ): NotificationTapSubscription;
}

export type NotificationTapHandler = (data: Record<string, unknown> | undefined) => void;

/** Far more taps than one app process sees; the oldest entries fall off first. */
const HANDLED_DELIVERY_LIMIT = 32;
const handledDeliveries: string[] = [];

function deliveryKey(response: NotificationResponseLike): string {
  const { date, request } = response.notification;
  return `${request.identifier}\u0000${String(date)}`;
}

function rememberHandled(response: NotificationResponseLike): boolean {
  const key = deliveryKey(response);
  if (handledDeliveries.includes(key)) {
    return false;
  }
  handledDeliveries.push(key);
  if (handledDeliveries.length > HANDLED_DELIVERY_LIMIT) {
    handledDeliveries.shift();
  }
  return true;
}

function readTapData(response: NotificationResponseLike): Record<string, unknown> | undefined {
  const data = response.notification.request.content.data;
  if (typeof data !== "object" || data === null) {
    return undefined;
  }
  return data as Record<string, unknown>;
}

/**
 * Subscribes to taps and hands over the tap that launched the app, if any. Returns the
 * unsubscribe for the router's effect cleanup.
 */
export function subscribeToNotificationTaps(
  source: NotificationResponseSource,
  open: NotificationTapHandler,
): () => void {
  function handle(response: NotificationResponseLike): void {
    if (!rememberHandled(response)) {
      return;
    }
    source.clearLastNotificationResponse();
    open(readTapData(response));
  }

  const subscription = source.addNotificationResponseReceivedListener(handle);
  const launchTap = source.getLastNotificationResponse();
  if (launchTap) {
    handle(launchTap);
  }
  return () => subscription.remove();
}

/** Test seam: the handled deliveries are process state on purpose. */
export function forgetHandledNotificationTapsForTest(): void {
  handledDeliveries.length = 0;
}
