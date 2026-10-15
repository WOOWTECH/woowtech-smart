import { BRAND } from "@getpaseo/protocol/brand-values";
import React from "react";
import Svg, { Circle, G, Path } from "react-native-svg";

import { BRAND_LOGO_COLOR } from "@/styles/brand";

interface PaseoLogoProps {
  size?: number;
  /** Ignored: the logo is a brand mark, always drawn in the brand's own colors. */
  color?: string;
}

// The brand's logo (woowtech/brands). woowtech smart draws the WOOW symbol, from
// woowtech/brand/woowtech-symbol-path.svg, in its brand blue. Apporo smart draws its grey mark
// inside a white disc with a light ring, as Apporo's other apps do (owner 2026-10-15). Each
// stroke is its own path: the WOOW strokes overlap, and one combined path would cut holes where
// they cross.
const SYMBOL_STROKES: readonly string[] = BRAND.logo.paths;
const VIEW_BOX = BRAND.logo.viewBox;
const LOGO_STYLE: "mark" | "badge" = BRAND.logo.style;

// The badge is drawn on a 100 x 100 box: a disc with a ring 3 units wide, and the mark centered
// at markWidths.badge percent of the box's width.
const BADGE_VIEW_BOX = "0 0 100 100";
const BADGE_RING_WIDTH = 3;
const [MARK_X = 0, MARK_Y = 0, MARK_WIDTH = 1, MARK_HEIGHT = 1] = VIEW_BOX.split(/\s+/).map(Number);
const BADGE_MARK_SCALE = BRAND.logo.markWidths.badge / MARK_WIDTH;
const BADGE_MARK_TRANSFORM = `translate(${50 - (MARK_X + MARK_WIDTH / 2) * BADGE_MARK_SCALE} ${
  50 - (MARK_Y + MARK_HEIGHT / 2) * BADGE_MARK_SCALE
}) scale(${BADGE_MARK_SCALE})`;

function badgeSvgBody(): string {
  const strokes = SYMBOL_STROKES.map(
    (stroke) => `<path fill='${BRAND.logo.tileColor}' d='${stroke}'/>`,
  ).join("");
  return `<circle cx='50' cy='50' r='${50 - BADGE_RING_WIDTH / 2}' fill='#ffffff' stroke='${BRAND.logo.badgeRing}' stroke-width='${BADGE_RING_WIDTH}'/><g transform='${BADGE_MARK_TRANSFORM}'>${strokes}</g>`;
}

/** The logo's silhouette as an SVG document in black, for the web splash's CSS mask. */
export function woowSymbolMaskSvg(size: number): string {
  if (LOGO_STYLE === "badge") {
    return `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='${BADGE_VIEW_BOX}'><circle fill='black' cx='50' cy='50' r='50'/></svg>`;
  }
  const strokes = SYMBOL_STROKES.map((stroke) => `<path fill='black' d='${stroke}'/>`).join("");
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='${VIEW_BOX}'>${strokes}</svg>`;
}

/** The badge in its own colors as an SVG document, for the web splash; null for a plain mark. */
export function brandBadgeSvg(size: number): string | null {
  if (LOGO_STYLE !== "badge") {
    return null;
  }
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='${BADGE_VIEW_BOX}'>${badgeSvgBody()}</svg>`;
}

export function PaseoLogo({ size = 64 }: PaseoLogoProps) {
  if (LOGO_STYLE === "badge") {
    return (
      <Svg width={size} height={size} viewBox={BADGE_VIEW_BOX} fill="none">
        <Circle
          cx={50}
          cy={50}
          r={50 - BADGE_RING_WIDTH / 2}
          fill="#ffffff"
          stroke={BRAND.logo.badgeRing}
          strokeWidth={BADGE_RING_WIDTH}
        />
        <G transform={BADGE_MARK_TRANSFORM}>
          {SYMBOL_STROKES.map((stroke) => (
            <Path key={stroke} d={stroke} fill={BRAND.logo.tileColor} />
          ))}
        </G>
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox={VIEW_BOX} fill="none">
      {SYMBOL_STROKES.map((stroke) => (
        <Path key={stroke} d={stroke} fill={BRAND_LOGO_COLOR} />
      ))}
    </Svg>
  );
}
