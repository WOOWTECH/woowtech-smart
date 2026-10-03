// woowtech smart: how a downloaded update installs on Windows (woowtech/README.md §25, plan G37,
// D20). Installing at quit is unsafe there: quitting and then shutting Windows down kills the
// silent installer half-way and leaves the app uninstalled (electron-builder #7807), and with the
// tray (G1) a quit is often followed by a shutdown. So Windows installs only from an explicit
// "Restart to update", and that restart runs the installer silently, as the Mac's restart does,
// instead of showing the installer's wizard. macOS and Linux keep upstream's behavior.

export function installsUpdateOnQuit(platform: NodeJS.Platform): boolean {
  return platform !== "win32";
}

export interface UpdateInstallMode {
  isSilent: boolean;
  isForceRunAfter: boolean;
}

export interface UpdateInstallModeInput extends UpdateInstallMode {
  platform: NodeJS.Platform;
}

export function updateInstallMode(input: UpdateInstallModeInput): UpdateInstallMode {
  if (input.platform === "win32" && input.isForceRunAfter) {
    return { isSilent: true, isForceRunAfter: true };
  }
  return { isSilent: input.isSilent, isForceRunAfter: input.isForceRunAfter };
}
