import type { DesktopPermissionState } from "./desktop-permissions";

export type TestNotificationState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "success" }
  | { status: "error"; message: string };

export function canTestNotification(state: DesktopPermissionState | undefined): boolean {
  return state === "granted" || state === "unknown";
}

interface NotificationTestInput {
  send: () => Promise<boolean>;
  failureMessage: string;
  onState: (state: TestNotificationState) => void;
}

export async function runNotificationTest(input: NotificationTestInput): Promise<void> {
  input.onState({ status: "sending" });
  try {
    const sent = await input.send();
    input.onState(
      sent ? { status: "success" } : { status: "error", message: input.failureMessage },
    );
  } catch {
    input.onState({ status: "error", message: input.failureMessage });
  }
}
