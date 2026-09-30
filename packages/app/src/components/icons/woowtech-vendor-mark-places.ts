import type { VendorMarkStyle } from "./woowtech-vendor-mark-styles.gen";

// woowtech smart: where a vendor mark is drawn decides whether it shows its logo
// (woowtech/README.md section 25; the marks and their conditions are woowtech/vendor-marks.mjs).
// A mark is drawn in the colour its place gives it (theme), in pure black or white by the theme
// (mono), or in its own colours (original), and some may only appear beside their product's name.
// A place nobody has checked may dim its icon, as disabled menu items and dimmed rows do, and may
// show a title instead of the product's name. There a mono or original mark, or one that may only
// appear beside its name, draws the vendor's text badge. This module has no React Native imports,
// so screens can name their place without loading the drawing code.

/** Where a vendor mark is drawn. */
export interface VendorMarkPlace {
  /** The product's name stands beside the icon. */
  readonly nameBeside: boolean;
  /** The place never dims, fades or tints its icon, in any state. */
  readonly keepsColors: boolean;
}

/** A place nobody has checked: it may not name the product, and it may dim its icon. */
export const UNCHECKED_PLACE: VendorMarkPlace = { nameBeside: false, keepsColors: false };

/**
 * A row that names the provider beside its icon and never dims it: the settings provider list and
 * the ACP catalog.
 */
export const NAMED_ROW: VendorMarkPlace = { nameBeside: true, keepsColors: true };

/** Whether a mark drawn as `style` may show its logo at `place`; if not, it draws its badge. */
export function drawsLogoAt(style: VendorMarkStyle, place: VendorMarkPlace): boolean {
  if (style.onlyBesideName && !place.nameBeside) return false;
  return style.color === "theme" || place.keepsColors;
}

/** A key for caching the icon of `id` drawn at `place`. */
export function vendorMarkPlaceKey(id: string, place: VendorMarkPlace): string {
  return `${id}:${place.nameBeside ? "named" : "unnamed"}:${place.keepsColors ? "kept" : "dimmable"}`;
}
