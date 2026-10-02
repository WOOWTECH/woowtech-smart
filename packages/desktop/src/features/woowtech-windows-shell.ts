// woowtech smart: the Windows app behaves like the Mac app (README §25). Closing the last
// window leaves the app in the notification area the way macOS leaves it in the Dock: the
// daemon and agents keep running and, with no window open, the next notification goes to
// the phones. Quit from the tray menu is Cmd+Q. Opening the app again brings back the
// existing window instead of adding one.

/**
 * macOS registers the scheme from Info.plist at build time. electron-builder's NSIS template
 * only registers file associations, so the packaged Windows app writes
 * HKCU\Software\Classes\<scheme> itself on every start. An unpackaged run would point the
 * scheme at a dev Electron, so it skips this.
 */
export function registerAgentLinkProtocol(input: {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  scheme: string;
  setAsDefaultProtocolClient: (scheme: string) => boolean;
}): boolean {
  if (input.platform !== "win32" || !input.isPackaged) {
    return false;
  }
  try {
    return input.setAsDefaultProtocolClient(input.scheme);
  } catch {
    return false;
  }
}

export interface TrayLabels {
  tooltip: string;
  open: string;
  quit: string;
}

// Traditional Chinese follows the fork's other zh-TW strings; every other language, Simplified
// Chinese included, keeps upstream's English (README §7).
const TRADITIONAL_CHINESE = /^zh-(hant|tw|hk|mo)(-|$)/;

export function trayLabels(input: {
  appName: string;
  preferredLanguages: readonly string[];
}): TrayLabels {
  const language = (input.preferredLanguages[0] ?? "").toLowerCase();
  if (TRADITIONAL_CHINESE.test(language)) {
    return { tooltip: input.appName, open: `開啟 ${input.appName}`, quit: "結束" };
  }
  return { tooltip: input.appName, open: `Open ${input.appName}`, quit: "Quit" };
}

export function quitWhenAllWindowsClosed(input: {
  platform: NodeJS.Platform;
  trayActive: boolean;
}): boolean {
  if (input.platform === "darwin") {
    return false;
  }
  // Without a tray icon there would be no way back to a running app, so quit as upstream does.
  return !(input.platform === "win32" && input.trayActive);
}

export type RelaunchAction = "focus" | "open-window";

/** What a second launch without an agent link does. */
export function relaunchAction(input: {
  platform: NodeJS.Platform;
  hasAppLink: boolean;
  openProjectPath: string | null;
}): RelaunchAction {
  // Pairing and other non-agent woowtech-smart: links have nothing to open on the desktop.
  if (input.hasAppLink) {
    return "focus";
  }
  // `woowtech-smart <path>` and "open in new window" keep upstream's new-window behavior.
  if (input.openProjectPath) {
    return "open-window";
  }
  return input.platform === "win32" ? "focus" : "open-window";
}
