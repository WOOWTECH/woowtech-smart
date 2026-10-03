// woowtech smart: the notification-test hint points at the OS's own settings. Windows has no
// "System Settings"; its toggle is Settings › System › Notifications (README §25, plan G19).
export interface DesktopNotificationHelpKeys {
  failed: string;
  unconfirmed: string;
}

export function desktopNotificationHelpKeys(
  platform: string | undefined,
): DesktopNotificationHelpKeys {
  if (platform?.toLowerCase() === "win32") {
    return {
      failed: "woowtech.desktopNotifications.failedWindows",
      unconfirmed: "woowtech.desktopNotifications.unconfirmedWindows",
    };
  }
  return {
    failed: "woowtech.desktopNotifications.failed",
    unconfirmed: "woowtech.desktopNotifications.unconfirmed",
  };
}
