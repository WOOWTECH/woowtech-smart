import type { DesktopNotificationBridge, NotificationDeliveryResult } from "@/desktop/host";
import type { DesktopPermissionState } from "./desktop-permissions";

export type TestNotificationState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "success" }
  | { status: "error"; message: string }
  | { status: "unconfirmed"; message: string };

export function canTestNotification(state: DesktopPermissionState | undefined): boolean {
  return state === "granted" || state === "unknown";
}

interface DesktopTestNotificationInput {
  bridge: DesktopNotificationBridge | undefined;
  payload: Parameters<NonNullable<DesktopNotificationBridge["sendNotification"]>>[0];
}

export async function sendDesktopTestNotification(
  input: DesktopTestNotificationInput,
): Promise<NotificationDeliveryResult> {
  if (input.bridge?.sendNotificationWithResult) {
    return input.bridge.sendNotificationWithResult(input.payload);
  }
  if (!input.bridge?.sendNotification) return "failed";
  // COMPAT(notificationDeliveryResult): added in v0.8.0, remove after 2026-12-26.
  // Legacy booleans cannot distinguish show evidence, timeout, or show() returning.
  await input.bridge.sendNotification(input.payload);
  return "unconfirmed";
}

interface NotificationTestInput {
  send: () => Promise<NotificationDeliveryResult>;
  failureMessage: string;
  unconfirmedMessage: string;
  onState: (state: TestNotificationState) => void;
}

export async function runNotificationTest(input: NotificationTestInput): Promise<void> {
  input.onState({ status: "sending" });
  try {
    const sent = await input.send();
    if (sent === "shown") {
      input.onState({ status: "success" });
    } else if (sent === "failed") {
      input.onState({ status: "error", message: input.failureMessage });
    } else {
      input.onState({ status: "unconfirmed", message: input.unconfirmedMessage });
    }
  } catch {
    input.onState({ status: "error", message: input.failureMessage });
  }
}
