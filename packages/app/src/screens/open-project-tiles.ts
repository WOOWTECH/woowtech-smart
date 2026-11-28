// The home tiles sit two to a row. The md breakpoint follows the window, but with the sidebar
// docked the home pane can be narrower than two full tiles, as on an iPad in portrait. On a touch
// device the row then splits its measured width between two narrower tiles, and becomes one
// full-width column once two would get too narrow to read. Pointer layouts keep upstream's fixed
// tiles at every window width (owner decision 2026-11-28: no desktop layout upstream lacks).
import type { ControlSizing } from "@/components/ui/control-geometry";

export const HOME_TILE_WIDTH = 220;
export const HOME_TILE_MIN_WIDTH = 180;
export const HOME_TILE_GAP = 12;

/** Whether the tiles fit themselves to the measured row: touch-sized wide layouts only. */
export function fitsHomeTilesToRow(compactLayout: boolean, sizing: ControlSizing): boolean {
  return !compactLayout && sizing === "touch";
}

/** The width of each tile in a row `rowWidth` points wide, from the md breakpoint up. */
export function resolveHomeTileWidth(rowWidth: number): number {
  const twoUp = Math.floor((rowWidth - HOME_TILE_GAP) / 2);
  if (twoUp >= HOME_TILE_MIN_WIDTH) return Math.min(HOME_TILE_WIDTH, twoUp);
  return rowWidth;
}
