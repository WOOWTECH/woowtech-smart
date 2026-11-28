import * as Notifications from "expo-notifications";
import { createNativeNotificationOpenSource } from "./native";
import type { NotificationOpenSource } from "./source";

export function createNotificationOpenSource(): NotificationOpenSource {
  return createNativeNotificationOpenSource(Notifications);
}
