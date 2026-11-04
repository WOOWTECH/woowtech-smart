import { BRAND } from "@getpaseo/protocol/brand-values";

/** The brand's color (woowtech smart's blue): its logo and the theme's highlight accent. */
export const BRAND_COLOR = BRAND.colors.primary;

/** A lighter step of the brand's color for links on dark surfaces, where the brand color is too dark. */
export const BRAND_COLOR_ON_DARK = BRAND.colors.accentOnDark;

/**
 * The color the app draws the brand's logo in on a light background: woowtech smart's blue,
 * Apporo smart's dark grey.
 */
export const BRAND_LOGO_COLOR = BRAND.logo.color;

/**
 * The color of the brand's logo on a dark background: woowtech smart's blue again, Apporo smart's
 * white (owner 2026-10-30: the bare mark, dark grey lines on light, white lines on dark).
 */
export const BRAND_LOGO_COLOR_ON_DARK = BRAND.logo.colorOnDark;

/** The logo's color for a theme's color scheme. */
export function brandLogoColor(colorScheme: "light" | "dark"): string {
  return colorScheme === "dark" ? BRAND_LOGO_COLOR_ON_DARK : BRAND_LOGO_COLOR;
}
