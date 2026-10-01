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
// The handled identifiers live at module scope, so they survive remounts of the router, and the
// native copy is cleared once handled, so a reload of the JS bundle cannot replay it either.

export interface NotificationResponseLike {
  notification: {
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
const HANDLED_IDENTIFIER_LIMIT = 32;
const handledIdentifiers: string[] = [];

function rememberHandled(identifier: string): boolean {
  if (handledIdentifiers.includes(identifier)) {
    return false;
  }
  handledIdentifiers.push(identifier);
  if (handledIdentifiers.length > HANDLED_IDENTIFIER_LIMIT) {
    handledIdentifiers.shift();
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
    if (!rememberHandled(response.notification.request.identifier)) {
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

/** Test seam: the identifiers are process state on purpose. */
export function forgetHandledNotificationTapsForTest(): void {
  handledIdentifiers.length = 0;
}
