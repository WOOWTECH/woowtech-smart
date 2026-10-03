// woowtech smart: Windows refuses to bring a background process's window to the front, and
// the hand-over from a second instance started by a toast click often fails (plan B4, H1 §Q2).
// Toggling always-on-top lifts the window anyway, without native code; Signal Desktop uses the
// same fallback. A window that is already showing is not shown again: show() moves a snapped
// window (Signal #1429).
import type { BrowserWindow } from "electron";

export function raiseWindowsWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) {
    return;
  }
  if (win.isMinimized()) {
    win.restore();
  }
  if (!win.isVisible()) {
    win.show();
  }
  win.setAlwaysOnTop(true);
  win.focus();
  win.setAlwaysOnTop(false);
}
