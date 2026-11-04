// woowtech smart: the notification-test hint points at the OS's own settings. Windows has no
// "System Settings"; its toggle is Settings › System › Notifications (README §31, plan G19).
export interface DesktopNotificationHelpKeys {
  failed: string;
  unconfirmed: string;
}

export interface DesktopBannerCheckKeys {
  idleDescription: string;
  askDescription: string;
  helpDescription: string;
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

// "Did you see the banner?" (README section 16) says where to look and what to turn on. Windows
// shows banners at the bottom right, not the top right, and has neither System Settings nor Focus.
export function desktopBannerCheckKeys(platform: string | undefined): DesktopBannerCheckKeys {
  if (platform?.toLowerCase() === "win32") {
    return {
      idleDescription: "woowtech.notificationBannerCheck.idleDescriptionWindows",
      askDescription: "woowtech.notificationBannerCheck.askDescriptionWindows",
      helpDescription: "woowtech.notificationBannerCheck.helpDescriptionWindows",
    };
  }
  return {
    idleDescription: "woowtech.notificationBannerCheck.idleDescription",
    askDescription: "woowtech.notificationBannerCheck.askDescription",
    helpDescription: "woowtech.notificationBannerCheck.helpDescription",
  };
}
