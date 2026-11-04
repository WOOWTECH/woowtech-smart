// woowtech smart: which woowtech smart.exe `woowtech-smart open` starts on Windows (H5 F4).
// The bundled CLI runs inside the app's own exe (ELECTRON_RUN_AS_NODE), so that exe is the app,
// wherever it was installed; otherwise the default per-user install folder.
import path from "node:path";
import { DESKTOP_APP_NAME } from "@getpaseo/protocol/brand-desktop";

const APP_EXE = `${DESKTOP_APP_NAME}.exe`;

export interface WindowsDesktopAppLookup {
  env: NodeJS.ProcessEnv;
  execPath: string;
  exists: (filePath: string) => boolean;
}

export function windowsDesktopAppPath(lookup: WindowsDesktopAppLookup): string | null {
  if (
    lookup.env.ELECTRON_RUN_AS_NODE === "1" &&
    path.win32.basename(lookup.execPath).toLowerCase() === APP_EXE.toLowerCase()
  ) {
    return lookup.execPath;
  }
  const localAppData = lookup.env.LOCALAPPDATA;
  if (!localAppData) {
    return null;
  }
  const installed = path.win32.join(localAppData, "Programs", DESKTOP_APP_NAME, APP_EXE);
  return lookup.exists(installed) ? installed : null;
}
