import { Children, isValidElement } from "react";
import { describe, expect, it } from "vitest";
import { brandLogoColor } from "@/styles/brand";
import { BrandMark, PaseoLogo, woowSymbolMaskSvg } from "./paseo-logo";

function strokeFills(fill: string): (string | undefined)[] {
  const svg = BrandMark({ size: 32, fill });
  return Children.toArray(svg.props.children).map((stroke) =>
    isValidElement<{ fill?: string }>(stroke) ? stroke.props.fill : undefined,
  );
}

describe("PaseoLogo", () => {
  it("draws every stroke of the WOOW symbol in the brand blue on light and dark themes", () => {
    for (const scheme of ["light", "dark"] as const) {
      expect(brandLogoColor(scheme)).toBe("#6183fc");
      const fills = strokeFills(brandLogoColor(scheme));
      expect(fills).toHaveLength(10);
      expect(new Set(fills)).toEqual(new Set(["#6183fc"]));
    }
  });

  it("ignores the color a caller asks for: the theme decides", () => {
    for (const color of [undefined, "#000000", "#ffffff"]) {
      expect(PaseoLogo({ size: 32, color }).props).toEqual({ size: 32 });
    }
  });

  it("is the mask the web splash draws, every stroke on the symbol's viewBox", () => {
    const strokes = Children.toArray(BrandMark({ size: 96, fill: "#000000" }).props.children).map(
      (stroke) => (isValidElement<{ d?: string }>(stroke) ? stroke.props.d : undefined),
    );
    const mask = woowSymbolMaskSvg(96);

    expect(mask).toContain("width='96' height='96' viewBox='0 0 105.2 83.4'");
    expect([...mask.matchAll(/ d='([^']+)'/g)].map((match) => match[1])).toEqual(strokes);
  });
});
