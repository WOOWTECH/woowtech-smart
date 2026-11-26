import { getDesktopHost } from "@/desktop/host";
import { acquireDesktopMenuShortcutCapture } from "@/desktop/menu-shortcut-capture";
import { getResidentBrowserWebview } from "@/desktop/browser/resident-webviews";
import { setCommandCenterFocusRestoreElement } from "@/utils/command-center-focus-restore";
import { buildBrowserKeyboardPolicy, attachElectronBrowserSource } from "./electron-browser";
import { attachDomKeyboardSource } from "./dom.web";
import { subscribeDomKeyboardCapture } from "../dom-keyboard-capture.web";
import type { KeyboardSourceHandlers } from "./contract";
export function attachKeyboardSources(handlers: KeyboardSourceHandlers): () => void {
  const detachDom = attachDomKeyboardSource(handlers);
  const host = getDesktopHost();
  let releaseMenuCapture: (() => void) | null = null;
  const detachCapture = subscribeDomKeyboardCapture((capturing) => {
    if (capturing) releaseMenuCapture ??= acquireDesktopMenuShortcutCapture();
    else {
      releaseMenuCapture?.();
      releaseMenuCapture = null;
    }
  });
  const subscribeGuest = host?.events?.on;
  const detachGuest = subscribeGuest
    ? attachElectronBrowserSource(
        {
          subscribe: (handler) => subscribeGuest("browser-shortcut-input", handler),
          captureFocusRestore: (browserId) =>
            setCommandCenterFocusRestoreElement(getResidentBrowserWebview(browserId)),
        },
        handlers,
      )
    : () => {};
  return () => {
    detachDom();
    detachGuest();
    detachCapture();
  };
}
export function publishKeyboardPolicy(input: import("./contract").KeyboardPolicyInput): void {
  const policy = input.enabled
    ? buildBrowserKeyboardPolicy(input)
    : { menuPrefixes: [], prefixes: [] };
  void getDesktopHost()?.browser?.setShortcutPolicy?.(policy);
}
