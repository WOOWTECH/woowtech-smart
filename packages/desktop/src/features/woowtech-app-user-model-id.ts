// woowtech smart: Windows ties toasts and their clicks to the AppUserModelID of the Start
// Menu shortcut, which electron-builder's NSIS installer registers with `appId`. Electron
// does not set it, so the app must. Keep this equal to electron-builder.yml's appId (a guard
// checks it).
export const WOOWTECH_DESKTOP_APP_ID = "io.woowtech.smart.desktop";

// Electron (40.5+) writes the toast activator CLSID into the Start Menu shortcut and
// HKCU\Software\Classes\CLSID on the first notification, and picks a new random one every run
// unless told otherwise. Unpackaged runs use their own id and CLSID so a dev Electron never
// takes over the installed app's registration.
export const WOOWTECH_TOAST_ACTIVATOR_CLSID = "{202C5D44-4389-4CA6-BC75-2E1C50DCCFA0}";
export const WOOWTECH_DEV_APP_ID = `${WOOWTECH_DESKTOP_APP_ID}.dev`;
export const WOOWTECH_DEV_TOAST_ACTIVATOR_CLSID = "{F6B7577F-236A-4BA0-8712-3C3D33795471}";

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
