import { BRAND } from "@getpaseo/protocol/brand-values";

/** The brand's color (woowtech smart's blue): its logo and the theme's highlight accent. */
export const BRAND_COLOR = BRAND.colors.primary;

/** A lighter step of the brand's color for links on dark surfaces, where the brand color is too dark. */
export const BRAND_COLOR_ON_DARK = BRAND.colors.accentOnDark;

/**
 * The color the app draws the brand's logo in, on any theme: woowtech smart's blue; Apporo's
 * gold, which stays readable on dark backgrounds where its grey mark would not.
 */
export const BRAND_LOGO_COLOR = BRAND.logo.color;
