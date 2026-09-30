import {
  EDITOR_ICON_STYLES,
  type VendorMarkStyle,
} from "@/components/icons/woowtech-vendor-mark-styles.gen";
import type { DesktopOpenTargetIcon } from "@/workspace/desktop-open-targets";

// woowtech smart: the desktop "Open in" button (woowtech/README.md section 25). Its menu names every
// editor beside its icon; the button itself shows only the icon when it hides its label, as it does
// in the workspace header. Google asks that its product icons never stand on their own, and
// Microsoft's VS Code buttons read "Open in VS Code", so there their marks give way to the generic
// editor icon (woowtech/vendor-marks.mjs, onlyBesideName).

/** The generic editor icon: the terminal symbol upstream gives an editor without a logo. */
export const GENERIC_EDITOR_ICON: DesktopOpenTargetIcon = { kind: "symbol", name: "terminal" };

/** The icon of editor target `target` where it stands alone, with no name beside it. */
export function editorIconAlone(
  target: { editorId: string; icon: DesktopOpenTargetIcon },
  styles: Readonly<Record<string, VendorMarkStyle>> = EDITOR_ICON_STYLES,
): DesktopOpenTargetIcon {
  if (target.icon.kind !== "image") return target.icon;
  return styles[target.editorId]?.onlyBesideName ? GENERIC_EDITOR_ICON : target.icon;
}
