import { getDesktopHost } from "./host";

let captures = 0;

/** App and plugin recorders share ownership of the native menu in this window. */
export function acquireDesktopMenuShortcutCapture(): () => void {
  const menu = getDesktopHost()?.menu;
  const setCapturingShortcut = menu?.setCapturingShortcut?.bind(menu);
  if (!setCapturingShortcut) return () => {};
  if (captures++ === 0) void setCapturingShortcut(true);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--captures === 0) void setCapturingShortcut(false);
  };
}
