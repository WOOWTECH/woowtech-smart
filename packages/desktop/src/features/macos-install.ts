import { accessSync, constants, lstatSync } from "node:fs";
import path from "node:path";
import type { App, Dialog } from "electron";

interface InstallRuntime {
  platform: NodeJS.Platform;
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  appName: string;
  hasPendingLaunch: () => boolean;
  app: Pick<
    App,
    | "isPackaged"
    | "isInApplicationsFolder"
    | "getPreferredSystemLanguages"
    | "moveToApplicationsFolder"
  >;
  dialog: Pick<Dialog, "showMessageBoxSync">;
  checkDestination: () => "available" | "exists" | "manual";
  onError: (error: unknown) => void;
}

// Fail closed on unreadable paths and dangling symlinks too. Electron's privileged
// copy path bypasses conflictHandler, so never enter it from this workflow.
export function checkMacInstallDestination(input: {
  execPath: string;
  home: string;
  applications: string;
}): "available" | "exists" | "manual" {
  const bundle = path.dirname(path.dirname(path.dirname(input.execPath)));
  if (!bundle.endsWith(".app")) return "manual";
  for (const directory of [input.applications, path.join(input.home, "Applications")]) {
    try {
      lstatSync(path.join(directory, path.basename(bundle)));
      return "exists";
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        return "manual";
      }
    }
  }
  try {
    accessSync(input.applications, constants.W_OK);
    return "available";
  } catch {
    return "manual";
  }
}

export function macInstallCopy(language: string, name: string) {
  if (/^zh-(hant|tw|hk|mo)(-|$)/i.test(language)) {
    return {
      prompt: `將 ${name} 安裝至「應用程式」？`,
      detail: "安裝後會重新開啟 App。你也可以暫時從目前位置使用。",
      install: "安裝並開啟",
      later: "暫時略過",
      ok: "好",
      exists:
        "「應用程式」已有同名 App，未進行取代。請從 Finder 開啟已安裝的 App，並使用 App 內的更新功能。",
      manual:
        "無法安全地自動安裝。請結束 App，再用 Finder 將它拖至「應用程式」；若已有副本，請開啟該副本並使用 App 內的更新功能。",
      failed: "安裝未完成，將繼續從目前位置開啟。你可以稍後結束 App，再用 Finder 安裝。",
    };
  }
  return {
    prompt: `Install ${name} in Applications?`,
    detail:
      "The app will reopen after installation. You can also use it from its current location for now.",
    install: "Install and Open",
    later: "Not Now",
    ok: "OK",
    exists:
      "An app with the same name is already in Applications. Nothing was replaced. Open the installed app in Finder and use its in-app updater.",
    manual:
      "Automatic installation is not available safely. Quit the app, then drag it to Applications in Finder. If a copy already exists, open that copy and use its in-app updater.",
    failed:
      "Installation did not finish. The app will open from its current location. You can quit and install it using Finder later.",
  };
}

/** Returns true only when Electron has taken ownership of quitting and relaunching. */
export function offerMacInstall(runtime: InstallRuntime): boolean {
  const { app, dialog, env } = runtime;
  // Only a plain packaged Finder launch is eligible. CLI, update/relaunch flags,
  // automation and launch intents must never be consumed by Electron's relaunch.
  const plainLaunch = runtime.argv.slice(1).every((arg) => arg.startsWith("-psn_"));
  const unattended = [
    "CI",
    "SSH_CONNECTION",
    "SSH_TTY",
    "ELECTRON_RUN_AS_NODE",
    "PASEO_DESKTOP_CLI",
    "PASEO_DESKTOP_SMOKE",
    "E2E_DESKTOP_RUNTIME",
    "WOOWTECH_SKIP_MAC_INSTALL",
    "PASEO_ELECTRON_FLAGS",
  ].some((key) => Boolean(env[key]));
  if (
    runtime.platform !== "darwin" ||
    !app.isPackaged ||
    !plainLaunch ||
    unattended ||
    runtime.hasPendingLaunch()
  ) {
    return false;
  }
  if (app.isInApplicationsFolder()) return false;

  const copy = macInstallCopy(app.getPreferredSystemLanguages()[0] ?? "en", runtime.appName);
  const answer = dialog.showMessageBoxSync({
    type: "question",
    title: runtime.appName,
    message: copy.prompt,
    detail: copy.detail,
    buttons: [copy.install, copy.later],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (answer !== 0 || runtime.hasPendingLaunch()) return false;

  let failure = copy.failed;
  try {
    const destination = runtime.checkDestination();
    if (destination !== "available") {
      failure = copy[destination];
    } else {
      const moved = app.moveToApplicationsFolder({
        conflictHandler: () => {
          failure = copy.exists;
          return false;
        },
      });
      if (moved) return true;
    }
  } catch (error) {
    runtime.onError(error);
  }
  dialog.showMessageBoxSync({
    type: "info",
    title: runtime.appName,
    message: failure,
    buttons: [copy.ok],
    defaultId: 0,
    cancelId: 0,
  });
  return false;
}
