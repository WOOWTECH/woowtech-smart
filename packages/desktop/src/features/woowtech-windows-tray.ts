// woowtech smart: the Windows notification-area icon, the Windows counterpart of the Dock
// icon (README §25). Policy lives in woowtech-windows-shell.ts.
import { Menu, Tray, nativeImage } from "electron";
import type { TrayLabels } from "./woowtech-windows-shell.js";

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
