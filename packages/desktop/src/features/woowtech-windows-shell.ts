// woowtech smart: the Windows app behaves like the Mac app (README §25). Closing the last
// window leaves the app in the notification area the way macOS leaves it in the Dock: the
// daemon and agents keep running and, with no window open, the next notification goes to
// the phones. Quit from the tray menu is Cmd+Q. Opening the app again brings back the
// existing window instead of adding one.

import path from "node:path";

/** electron-builder names the NSIS uninstaller after productName, next to the app's exe. */
export const WINDOWS_UNINSTALLER_NAME = "Uninstall woowtech smart.exe";

export function windowsUninstallerPath(execPath: string): string {
  return path.win32.join(path.win32.dirname(execPath), WINDOWS_UNINSTALLER_NAME);
}

/**
 * macOS registers the scheme from Info.plist at build time. electron-builder's NSIS template
 * only registers file associations, so the packaged Windows app writes
 * HKCU\Software\Classes\<scheme> itself on every start. Only the copy the installer put in
 * place does this: an unpackaged run, or a portable or unpacked copy, would point the scheme
 * at itself (plan B5).
 */
export function registerAgentLinkProtocol(input: {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  isInstalledCopy: () => boolean;
  scheme: string;
  setAsDefaultProtocolClient: (scheme: string) => boolean;
}): boolean {
  if (input.platform !== "win32" || !input.isPackaged || !input.isInstalledCopy()) {
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

export interface TrayHintText {
  title: string;
  body: string;
}

/**
 * Windows 11 puts a new tray icon in the hidden overflow and an app cannot move it out, so
 * after the first close the app looks gone while macOS keeps showing it in the Dock. One toast
 * on the first close says where it went (plan B8, H1 §Q7).
 */
export function trayHintText(input: {
  appName: string;
  preferredLanguages: readonly string[];
}): TrayHintText {
  const language = (input.preferredLanguages[0] ?? "").toLowerCase();
  if (TRADITIONAL_CHINESE.test(language)) {
    return {
      title: `${input.appName} 仍在執行`,
      body: "視窗關掉後，App 留在右下角的系統匣，agent 繼續跑。點工作列上的 ^ 可以找到圖示，也可以從開始功能表再開一次。",
    };
  }
  return {
    title: `${input.appName} is still running`,
    body: "Closing the window keeps the app in the notification area and your agents keep running. Click ^ on the taskbar to find the icon, or open it again from the Start menu.",
  };
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

// Windows adds launch flags of its own: the NSIS installer relaunches an updated app with
// `--updated`, and COM starts the app for a default toast clicked after it quit with
// `-Embedding`, from an unquoted path whose folder name can split into extra arguments. Each
// means "open the app", never CLI arguments (plan B1, B2).
const WINDOWS_LAUNCH_FLAGS = new Set(["--updated", "-embedding", "/embedding"]);

export function hasWindowsLaunchFlag(argv: readonly string[]): boolean {
  return argv.some((arg) => WINDOWS_LAUNCH_FLAGS.has(arg.trim().toLowerCase()));
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
