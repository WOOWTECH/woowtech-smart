import { describe, expect, it } from "vitest";
import {
  fitsHomeTilesToRow,
  HOME_TILE_GAP,
  HOME_TILE_MIN_WIDTH,
  HOME_TILE_WIDTH,
  resolveHomeTileWidth,
} from "./open-project-tiles";

describe("home tile width", () => {
  it("fits the tiles to the row only in a touch-sized wide layout", () => {
    // An iPad with the sidebar docked.
    expect(fitsHomeTilesToRow(false, "touch")).toBe(true);
    // A desktop window keeps upstream's fixed tiles however narrow it gets.
    expect(fitsHomeTilesToRow(false, "pointer")).toBe(false);
    // The compact layout already stacks full-width tiles from the stylesheet.
    expect(fitsHomeTilesToRow(true, "touch")).toBe(false);
  });

  it("keeps two full tiles where the row has room for them", () => {
    expect(resolveHomeTileWidth(2 * HOME_TILE_WIDTH + HOME_TILE_GAP)).toBe(HOME_TILE_WIDTH);
  });

  it("splits a narrower row into two narrower tiles that still fit beside each other", () => {
    // An iPad in portrait with the sidebar docked: a 490pt pane less its 24pt padding.
    const width = resolveHomeTileWidth(442);
    expect(width).toBe(215);
    expect(2 * width + HOME_TILE_GAP).toBeLessThanOrEqual(442);
  });

  it("falls back to one full-width column once two tiles would get too narrow", () => {
    const rowWidth = 2 * HOME_TILE_MIN_WIDTH + HOME_TILE_GAP - 1;
    expect(resolveHomeTileWidth(rowWidth)).toBe(rowWidth);
    expect(resolveHomeTileWidth(2 * HOME_TILE_MIN_WIDTH + HOME_TILE_GAP)).toBe(HOME_TILE_MIN_WIDTH);
  });
});
