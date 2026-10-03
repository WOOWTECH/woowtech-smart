// woowtech smart: the Windows notification-area icon, the Windows counterpart of the Dock
// icon (README §25). Policy lives in woowtech-windows-shell.ts.
import { existsSync, writeFileSync } from "node:fs";
import { Menu, Notification, Tray, nativeImage } from "electron";
import type { TrayHintText, TrayLabels } from "./woowtech-windows-shell.js";

export function createWindowsTray(input: {
  iconPath: string | null;
  labels: TrayLabels;
  onOpen: () => void;
  onQuit: () => void;
}): Tray | null {
  if (!input.iconPath) {
    return null;
  }
  const image = nativeImage.createFromPath(input.iconPath);
  if (image.isEmpty()) {
    return null;
  }
  const tray = new Tray(image);
  tray.setToolTip(input.labels.tooltip);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: input.labels.open, click: input.onOpen },
      { type: "separator" },
      { label: input.labels.quit, click: input.onQuit },
    ]),
  );
  tray.on("click", input.onOpen);
  return tray;
}

// Kept until the user clicks or dismisses it, so a click still reaches the handler.
let trayHint: Notification | null = null;

/** Shows the first-close hint once per user profile; the marker file records that it was shown. */
export function showTrayHintOnce(input: {
  markerPath: string;
  text: TrayHintText;
  onClick: () => void;
}): boolean {
  if (existsSync(input.markerPath) || !Notification.isSupported()) {
    return false;
  }
  try {
    writeFileSync(input.markerPath, `${new Date().toISOString()}\n`);
  } catch {
    return false;
  }
  const hint = new Notification({ title: input.text.title, body: input.text.body, silent: true });
  hint.on("click", input.onClick);
  hint.on("close", () => {
    if (trayHint === hint) trayHint = null;
  });
  trayHint = hint;
  hint.show();
  return true;
}
