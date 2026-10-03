// woowtech smart: which woowtech smart.exe `woowtech-smart open` starts on Windows (H5 F4).
// The bundled CLI runs inside the app's own exe (ELECTRON_RUN_AS_NODE), so that exe is the app,
// wherever it was installed; otherwise the default per-user install folder.
import path from "node:path";

const APP_EXE = "woowtech smart.exe";

export interface WindowsDesktopAppLookup {
  env: NodeJS.ProcessEnv;
  execPath: string;
  exists: (filePath: string) => boolean;
}

export function windowsDesktopAppPath(lookup: WindowsDesktopAppLookup): string | null {
  if (
    lookup.env.ELECTRON_RUN_AS_NODE === "1" &&
    path.win32.basename(lookup.execPath).toLowerCase() === APP_EXE
  ) {
    return lookup.execPath;
  }
  const localAppData = lookup.env.LOCALAPPDATA;
  if (!localAppData) {
    return null;
  }
  const installed = path.win32.join(localAppData, "Programs", "woowtech smart", APP_EXE);
  return lookup.exists(installed) ? installed : null;
}
