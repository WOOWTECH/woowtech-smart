// woowtech smart: Windows ties toasts and their clicks to the AppUserModelID of the Start
// Menu shortcut, which electron-builder's NSIS installer registers with `appId`. Electron
// does not set it, so the app must. Keep this equal to electron-builder.yml's appId (a guard
// checks it).
export const WOOWTECH_DESKTOP_APP_ID = "io.woowtech.smart.desktop";

export function applyWindowsAppUserModelId(input: {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  execPath: string;
  setAppUserModelId: (id: string) => void;
}): string | null {
  if (input.platform !== "win32") {
    return null;
  }
  // Unpackaged runs have no installer shortcut; Electron's docs use the executable path.
  const id = input.isPackaged ? WOOWTECH_DESKTOP_APP_ID : input.execPath;
  input.setAppUserModelId(id);
  return id;
}
