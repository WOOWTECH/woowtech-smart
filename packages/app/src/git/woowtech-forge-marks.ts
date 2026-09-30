import { isMonochromeMarkIcon } from "@/components/icons/woowtech-monochrome-mark";
import { getForgeIconComponent } from "@/git/forge-icon";

// woowtech smart (woowtech/README.md section 24): GitHub and Codeberg allow their marks only in
// pure black or white. The pull request actions (create, view and merge a pull request) dim when
// disabled or unavailable, which would draw those marks grey, and their labels name no forge. So
// the actions draw the generic pull request glyph for them; the marks stay where the app does not
// dim them, such as "Open on GitHub".

/** An icon kind no forge registers: ForgeBrandIcon draws the generic pull request glyph for it. */
export const GENERIC_FORGE_ICON_KIND = "generic-change-request";

/**
 * The icon kind a place that dims its icon draws for the forge `iconKind`: the forge's own, or
 * the generic pull request glyph when the forge's mark must stay pure black or white.
 */
export function dimmableForgeIconKind(iconKind: string): string {
  return isMonochromeMarkIcon(getForgeIconComponent(iconKind)) ? GENERIC_FORGE_ICON_KIND : iconKind;
}
