import React from "react";
import Svg, { Path } from "react-native-svg";
import { withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";

// woowtech smart: GitHub and Codeberg allow their logos only in black or white, never tinted
// (woowtech/README.md section 24). The places that draw a forge mark pass it a muted grey, the
// foreground or a brand colour depending on their state, so a mark made here ignores the colour it
// is given and draws pure black on a light theme and pure white on a dark one, in every state.

export interface MonochromeMarkIconProps {
  size?: number;
  /** Ignored: the theme picks black or white. Accepted so the mark fits the forge icon props. */
  color?: string;
}

interface MarkDrawing {
  viewBox: string;
  path: string;
}

/** The fill of a monochrome mark on a theme of `colorScheme`. */
export function monochromeMarkColor(colorScheme: Theme["colorScheme"]): string {
  return colorScheme === "light" ? "#000000" : "#FFFFFF";
}

function markColorMapping(theme: Theme) {
  return { color: monochromeMarkColor(theme.colorScheme) };
}

function MarkSvg({ size, color, viewBox, path }: MarkDrawing & { size: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox={viewBox} fill={color}>
      <Path d={path} />
    </Svg>
  );
}

const ThemedMarkSvg = withUnistyles(MarkSvg);

const MONOCHROME_MARK_ICONS = new WeakSet<object>();

/** A forge icon component that draws `path` in pure black or white by the theme. */
export function createMonochromeMarkIcon({ viewBox, path }: MarkDrawing) {
  function MonochromeMarkIcon({ size = 16 }: MonochromeMarkIconProps) {
    return <ThemedMarkSvg size={size} viewBox={viewBox} path={path} uniProps={markColorMapping} />;
  }
  MONOCHROME_MARK_ICONS.add(MonochromeMarkIcon);
  return MonochromeMarkIcon;
}

/**
 * Whether `icon` is a mark made by createMonochromeMarkIcon. Places that dim their icon must not
 * draw one: a pure black or white mark at half opacity is grey (git/woowtech-forge-marks.ts).
 */
export function isMonochromeMarkIcon(icon: unknown): boolean {
  return typeof icon === "function" && MONOCHROME_MARK_ICONS.has(icon);
}
