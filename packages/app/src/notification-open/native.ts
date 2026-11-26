import type { NotificationOpenSource, NotificationTap } from "./source";

export interface NativeNotificationResponse {
  notification: {
    date: number;
    request: { identifier: string; content: { data?: Record<string, unknown> } };
  };
}

export interface NativeNotificationBehavior {
  shouldShowAlert: boolean;
  shouldShowBanner: boolean;
  shouldShowList: boolean;
  shouldPlaySound: boolean;
  shouldSetBadge: boolean;
}

/** The Expo boundary, also implemented by the F-Droid notification stub. */
export interface NativeNotifications {
  setNotificationHandler(handler: {
    handleNotification: () => Promise<NativeNotificationBehavior>;
  }): void;
  addNotificationResponseReceivedListener(
    listener: (response: NativeNotificationResponse) => void,
  ): { remove(): void };
  getLastNotificationResponseAsync(): Promise<NativeNotificationResponse | null>;
  clearLastNotificationResponse(): void;
}

function toTap(response: NativeNotificationResponse): NotificationTap {
  return {
    // The relay reuses an agent id as the APNs collapse id. Its delivery date distinguishes
    // a new notification for that agent from a replay of the same tap.
    id: JSON.stringify([response.notification.request.identifier, response.notification.date]),
    data: response.notification.request.content.data,
  };
}

export function createNativeNotificationOpenSource(
  notifications: NativeNotifications,
): NotificationOpenSource {
  notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: false,
      shouldShowBanner: false,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  return {
    subscribe(onTap) {
      const subscription = notifications.addNotificationResponseReceivedListener((response) =>
        onTap(toTap(response)),
      );
      return () => subscription.remove();
    },
    async takeLaunchTap() {
      const response = await notifications.getLastNotificationResponseAsync();
      return response ? toTap(response) : null;
    },
    acknowledge() {
      notifications.clearLastNotificationResponse();
    },
  };
}
