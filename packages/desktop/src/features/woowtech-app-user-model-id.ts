// woowtech smart: Windows ties toasts and their clicks to the AppUserModelID of the Start
// Menu shortcut, which electron-builder's NSIS installer registers with `appId`. Electron
// does not set it, so the app must. Both come from the brand's desktop app id (a guard
// checks they agree).
import {
  DESKTOP_APP_ID,
  WINDOWS_DEV_TOAST_ACTIVATOR_CLSID,
  WINDOWS_TOAST_ACTIVATOR_CLSID,
} from "@getpaseo/protocol/brand-desktop";

export const WOOWTECH_DESKTOP_APP_ID = DESKTOP_APP_ID;

// Electron (40.5+) writes the toast activator CLSID into the Start Menu shortcut and
// HKCU\Software\Classes\CLSID on the first notification, and picks a new random one every run
// unless told otherwise. Unpackaged runs use their own id and CLSID so a dev Electron never
// takes over the installed app's registration. Both CLSIDs are the brand's own, so another
// brand's app on the same PC keeps its notifications.
export const WOOWTECH_TOAST_ACTIVATOR_CLSID = WINDOWS_TOAST_ACTIVATOR_CLSID;
export const WOOWTECH_DEV_APP_ID = `${WOOWTECH_DESKTOP_APP_ID}.dev`;
export const WOOWTECH_DEV_TOAST_ACTIVATOR_CLSID = WINDOWS_DEV_TOAST_ACTIVATOR_CLSID;

export function applyWindowsAppUserModelId(input: {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  setAppUserModelId: (id: string) => void;
  setToastActivatorCLSID: (clsid: string) => void;
}): string | null {
  if (input.platform !== "win32") {
    return null;
  }
  const id = input.isPackaged ? WOOWTECH_DESKTOP_APP_ID : WOOWTECH_DEV_APP_ID;
  input.setAppUserModelId(id);
  input.setToastActivatorCLSID(
    input.isPackaged ? WOOWTECH_TOAST_ACTIVATOR_CLSID : WOOWTECH_DEV_TOAST_ACTIVATOR_CLSID,
  );
  return id;
}
