import type { DesktopNotificationBridge } from "@/desktop/host";

// woowtech smart: when a desktop notification is clicked with every window closed, Electron
// reopens the main window and holds the click until this renderer has subscribed to
// "notification-click" (packages/desktop/src/features/woowtech-notification-click.ts).
export async function takePendingDesktopNotificationClick(
  bridge: Pick<DesktopNotificationBridge, "takePendingClick"> | undefined,
): Promise<Record<string, unknown> | undefined> {
  const pending = await bridge?.takePendingClick?.();
  const data = pending?.data;
  return typeof data === "object" && data !== null && !Array.isArray(data) ? data : undefined;
}
