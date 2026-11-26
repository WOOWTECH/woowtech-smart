import { getDesktopHost } from "@/desktop/host";
import { createElectronNotificationOpenSource } from "./electron";
import { createNotificationOpenSource as createWebSource } from "./source.web";
import type { NotificationOpenSource } from "./source";

export function createNotificationOpenSource(): NotificationOpenSource {
  return createElectronNotificationOpenSource({ getHost: getDesktopHost, web: createWebSource() });
}
