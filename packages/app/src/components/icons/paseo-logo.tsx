import { BRAND } from "@getpaseo/protocol/brand-values";
import React from "react";
import Svg, { Path } from "react-native-svg";

import { BRAND_LOGO_COLOR } from "@/styles/brand";

interface PaseoLogoProps {
  size?: number;
  /** Ignored: the logo is a brand mark, always drawn in the brand's logo color. */
  color?: string;
}

// The brand's logo (woowtech/brands): woowtech smart's WOOW symbol, from
// woowtech/brand/woowtech-symbol-path.svg, or Apporo's mark. Each stroke is its own path: the
// WOOW strokes overlap, and one combined path would cut holes where they cross.
const SYMBOL_STROKES: readonly string[] = BRAND.logo.paths;
const VIEW_BOX = BRAND.logo.viewBox;

/** The symbol as an SVG document in black, for the web splash's CSS mask. */
export function woowSymbolMaskSvg(size: number): string {
  const strokes = SYMBOL_STROKES.map((stroke) => `<path fill='black' d='${stroke}'/>`).join("");
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='${VIEW_BOX}'>${strokes}</svg>`;
}

export function PaseoLogo({ size = 64 }: PaseoLogoProps) {
  return (
    <Svg width={size} height={size} viewBox={VIEW_BOX} fill="none">
      {SYMBOL_STROKES.map((stroke) => (
        <Path key={stroke} d={stroke} fill={BRAND_LOGO_COLOR} />
      ))}
    </Svg>
  );
}
