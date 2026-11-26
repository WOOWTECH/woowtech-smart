import type { DesktopHostBridge } from "@/desktop/host";
import { takePendingDesktopNotificationClick } from "@/utils/woowtech-notification-click";
import type { NotificationOpenSource, NotificationTap } from "./source";

export function createElectronNotificationOpenSource({
  getHost,
  web,
}: {
  getHost: () => DesktopHostBridge | null;
  web: NotificationOpenSource;
}): NotificationOpenSource {
  let nextId = 0;
  let activeListener: ((tap: NotificationTap) => void) | null = null;
  const pendingTaps: NotificationTap[] = [];

  function deliver(data: NotificationTap["data"]) {
    const tap = { id: `electron:${++nextId}`, data };
    if (activeListener) activeListener(tap);
    else pendingTaps.push(tap);
  }

  return {
    takeLaunchTap: () => web.takeLaunchTap(),
    acknowledge: (tap) => web.acknowledge(tap),
    subscribe(onTap) {
      const stopWeb = web.subscribe(onTap);
      activeListener = onTap;
      for (const tap of pendingTaps.splice(0)) onTap(tap);
      let disposed = false;
      let stopDesktop: (() => void) | undefined;
      const host = getHost();
      const subscription = host?.events?.on?.("notification-click", (payload: unknown) => {
        if (disposed) return;
        const data =
          typeof payload === "object" && payload !== null && "data" in payload
            ? payload.data
            : undefined;
        deliver(
          typeof data === "object" && data !== null && !Array.isArray(data)
            ? Object.fromEntries(Object.entries(data))
            : undefined,
        );
      });
      void Promise.resolve(subscription)
        .then(async (stop) => {
          if (disposed) {
            stop?.();
            return undefined;
          }
          stopDesktop = stop;
          if (!stop) return undefined;
          // Main holds a click that reopened this window until its listener is installed.
          // If the router remounts during this read, retain the consumed tap for the new listener.
          const data = await takePendingDesktopNotificationClick(host?.notification);
          if (data) deliver(data);
          return undefined;
        })
        .catch((error) => {
          console.warn("[NotificationOpen] Failed to receive desktop notification clicks", error);
        });
      return () => {
        disposed = true;
        if (activeListener === onTap) activeListener = null;
        stopWeb();
        stopDesktop?.();
      };
    },
  };
}
