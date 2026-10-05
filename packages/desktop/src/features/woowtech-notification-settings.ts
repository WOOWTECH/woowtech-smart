// woowtech smart (woowtech/README.md section 16): opens the system's notification settings from the
// "notifications are not showing" sidebar callout. Only these fixed URLs: the renderer cannot ask
// for another one, and the general opener (paseo:opener:openUrl) stays limited to http(s) and mailto.
import { shell } from "electron";

const NOTIFICATION_SETTINGS_URLS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
  win32: "ms-settings:notifications",
};

export function notificationSettingsUrl(platform: NodeJS.Platform): string | null {
  return NOTIFICATION_SETTINGS_URLS[platform] ?? null;
}

interface OpenSystemNotificationSettingsInput {
  platform?: NodeJS.Platform;
  openExternal?: (url: string) => Promise<void>;
}

/** False on a platform without a settings page, or when the system refused to open it. */
export async function openSystemNotificationSettings(
  input: OpenSystemNotificationSettingsInput = {},
): Promise<boolean> {
  const url = notificationSettingsUrl(input.platform ?? process.platform);
  if (!url) {
    return false;
  }
  const openExternal = input.openExternal ?? ((target: string) => shell.openExternal(target));
  try {
    await openExternal(url);
    return true;
  } catch (error) {
    console.warn("[Notifications] Could not open the system notification settings", error);
    return false;
  }
}
