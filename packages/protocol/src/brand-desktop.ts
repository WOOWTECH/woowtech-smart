// The desktop app's identity. Each brand's desktop app installs next to the others and next to
// the official Paseo, so the id that macOS, Windows and electron-updater key everything on is
// the brand's own (woowtech/README.md §5).
import { BRAND } from "./brand-values.js";

/** The bundle id on macOS, the AppUserModelID on Windows, and the update cache's name. */
export const DESKTOP_APP_ID = BRAND.desktop.appId;

/**
 * The COM class Windows starts when one of the installed app's notifications is clicked. Each
 * brand has its own, so with two brands on one PC a click opens the app it came from.
 */
export const WINDOWS_TOAST_ACTIVATOR_CLSID = BRAND.desktop.windowsToastActivatorClsid;

/** The same for unpackaged runs, which never take over the installed app's registration. */
export const WINDOWS_DEV_TOAST_ACTIVATOR_CLSID = BRAND.desktop.windowsDevToastActivatorClsid;

/** The desktop app's name: the window title, `<name>.app`, the executable. */
export const DESKTOP_APP_NAME = BRAND.name;

/** The start of the installers' file names: `woowtech-smart-0.8.1-arm64.dmg`. */
export const DESKTOP_ARTIFACT_PREFIX = BRAND.desktop.artifactPrefix;

/** The origin the packaged desktop app loads its screens from, which the daemon lets in. */
export const DESKTOP_APP_ORIGIN = `${BRAND.scheme}://app`;
