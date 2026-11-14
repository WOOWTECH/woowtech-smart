import { BRAND } from "@getpaseo/protocol/brand-values";
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
  it("draws every stroke of the selected brand mark in its light and dark colors", () => {
    for (const scheme of ["light", "dark"] as const) {
      const expectedColor = scheme === "dark" ? BRAND.logo.colorOnDark : BRAND.logo.color;
      expect(brandLogoColor(scheme)).toBe(expectedColor);
      const fills = strokeFills(brandLogoColor(scheme));
      expect(fills).toHaveLength(BRAND.logo.paths.length);
      expect(new Set(fills)).toEqual(new Set([expectedColor]));
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

    expect(mask).toContain(`width='96' height='96' viewBox='${BRAND.logo.viewBox}'`);
    expect([...mask.matchAll(/ d='([^']+)'/g)].map((match) => match[1])).toEqual(strokes);
  });
});
