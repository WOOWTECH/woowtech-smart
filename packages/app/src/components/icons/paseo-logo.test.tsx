import { Children, isValidElement } from "react";
import { describe, expect, it } from "vitest";
import { PaseoLogo } from "./paseo-logo";

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
});
