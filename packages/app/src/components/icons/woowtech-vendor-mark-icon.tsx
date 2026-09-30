import React, { type ComponentType } from "react";
import { SvgXml } from "react-native-svg";
import { withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { vendorBadgeSvg } from "./vendor-badge";
import { monochromeMarkColor } from "./woowtech-monochrome-mark";
import { drawsLogoAt, type VendorMarkPlace } from "./woowtech-vendor-mark-places";
import { ACP_ICON_STYLES, type VendorMarkStyle } from "./woowtech-vendor-mark-styles.gen";

// woowtech smart: how a vendor mark that shows its logo is drawn at a place, or its badge where
// the place does not meet the mark's conditions (woowtech/README.md section 25;
// woowtech-vendor-mark-places.ts says which places meet them).

interface MarkIconProps {
  size: number;
  color: string;
}

type MarkIcon = ComponentType<MarkIconProps>;

const ThemedSvgXml = withUnistyles(SvgXml);

function inPlaceColor(id: string, xml: string, kind: string): MarkIcon {
  function VendorMarkInPlaceColor({ size, color }: MarkIconProps) {
    return <SvgXml xml={xml} width={size} height={size} color={color} />;
  }
  VendorMarkInPlaceColor.displayName = `VendorMark${kind}(${id})`;
  return VendorMarkInPlaceColor;
}

// A mono mark never uses the colour its place gives it. Only the theme names the file or the
// colour it draws: withUnistyles lets a prop the element passes win over the theme's.

/** Fills a currentColor mark pure black on light themes and pure white on dark ones. */
function monoColorOnTheme(theme: Theme) {
  return { color: monochromeMarkColor(theme.colorScheme) };
}

/**
 * The theme's pick of a vendor's two files: `light` on light themes, `dark` on dark ones. Made
 * once per mark, never while rendering, so the mapping keeps its identity across renders.
 */
function fileOnTheme(light: string, dark: string) {
  return (theme: Theme) => ({ xml: theme.colorScheme === "light" ? light : dark });
}

/** A mono mark the vendor ships as two files: `light` for light themes, `dark` for dark ones. */
function monoFiles(id: string, light: string, dark: string): MarkIcon {
  const pickFile = fileOnTheme(light, dark);
  function VendorMarkMonoFiles({ size }: MarkIconProps) {
    return <ThemedSvgXml width={size} height={size} uniProps={pickFile} />;
  }
  VendorMarkMonoFiles.displayName = `VendorMarkMono(${id})`;
  return VendorMarkMonoFiles;
}

/** A mono mark drawn in currentColor, filled pure black or pure white by the theme. */
function mono(id: string, xml: string): MarkIcon {
  function VendorMarkMono({ size }: MarkIconProps) {
    return <ThemedSvgXml xml={xml} width={size} height={size} uniProps={monoColorOnTheme} />;
  }
  VendorMarkMono.displayName = `VendorMarkMono(${id})`;
  return VendorMarkMono;
}

function original(id: string, xml: string): MarkIcon {
  function VendorMarkOriginal({ size }: MarkIconProps) {
    return <SvgXml xml={xml} width={size} height={size} />;
  }
  VendorMarkOriginal.displayName = `VendorMarkOriginal(${id})`;
  return VendorMarkOriginal;
}

/**
 * The icon for ACP icon `id`, whose SVG is `svg`, at `place`, where woowtech smart draws it
 * differently from upstream: the badge where the place does not meet the mark's conditions, a
 * mono mark or a mark in its own colours. null where upstream's drawing, in the colour the place
 * gives it, is right: a mark in the theme's colour, and every badge.
 */
export function acpMarkIconAt(
  id: string,
  svg: string,
  place: VendorMarkPlace,
  style: VendorMarkStyle | undefined = ACP_ICON_STYLES[id],
): MarkIcon | null {
  if (!style) return null;
  if (!drawsLogoAt(style, place)) return inPlaceColor(id, vendorBadgeSvg(id), "Badge");
  if (style.color === "mono") {
    return style.onDark === undefined ? mono(id, svg) : monoFiles(id, svg, style.onDark);
  }
  if (style.color === "original") return original(id, svg);
  return null;
}
