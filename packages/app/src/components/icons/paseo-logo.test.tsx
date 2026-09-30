import { Children, isValidElement } from "react";
import { describe, expect, it } from "vitest";
import { PaseoLogo, woowSymbolMaskSvg } from "./paseo-logo";

function strokeFills(color: string | undefined): (string | undefined)[] {
  const svg = PaseoLogo({ size: 32, color });
  return Children.toArray(svg.props.children).map((stroke) =>
    isValidElement<{ fill?: string }>(stroke) ? stroke.props.fill : undefined,
  );
}

describe("PaseoLogo", () => {
  it("draws every stroke of the WOOW symbol in the brand blue, whatever color a caller asks for", () => {
    for (const color of [undefined, "#000000", "#ffffff"]) {
      const fills = strokeFills(color);
      expect(fills).toHaveLength(10);
      expect(new Set(fills)).toEqual(new Set(["#6183fc"]));
    }
  });

  it("is the mask the web splash draws, every stroke on the symbol's viewBox", () => {
    const strokes = Children.toArray(PaseoLogo({ size: 96 }).props.children).map((stroke) =>
      isValidElement<{ d?: string }>(stroke) ? stroke.props.d : undefined,
    );
    const mask = woowSymbolMaskSvg(96);

    expect(mask).toContain("width='96' height='96' viewBox='0 0 105.2 83.4'");
    expect([...mask.matchAll(/ d='([^']+)'/g)].map((match) => match[1])).toEqual(strokes);
  });
});
