import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { ACP_PROVIDER_ICON_SVGS } from "@/assets/acp-provider-icons";
import {
  CLAUDE_BADGE_FRAME,
  CLAUDE_BADGE_LETTER,
  CLAUDE_BADGE_SVG,
  CLAUDE_BADGE_VIEW_BOX,
} from "@/components/icons/claude-badge";
import { ICON_SIZE, REGISTERED_THEMES } from "@/styles/theme";
import { replaceProviderSnapshotIcons, resolveProviderIconName } from "./provider-icon-name";
import { getProviderIcon, type ProviderIconComponent } from "./provider-icons";

// A host can send its own SVG for a provider id. For a Claude id it must not reach the screen.
const HOST_SVG = '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z" /></svg>';

interface DrawnShape {
  d?: string;
  x?: number;
  rx?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

/** What an icon component draws at `size` in `color`: its SVG props and each shape's props. */
function draw(Icon: ProviderIconComponent, size: number, color: string) {
  if (typeof Icon !== "function") throw new Error("Expected a function component");
  const svg = (Icon as (props: { size: number; color: string }) => ReactElement)({ size, color });
  const { children, ...props } = svg.props as { children?: ReactNode; [key: string]: unknown };
  const shapes = Children.toArray(children).map((shape) =>
    isValidElement<DrawnShape>(shape) ? shape.props : {},
  );
  return { props, shapes };
}

function badgeIn(color: string): DrawnShape[] {
  return [
    {
      x: CLAUDE_BADGE_FRAME.x,
      rx: CLAUDE_BADGE_FRAME.rx,
      fill: "none",
      stroke: color,
      strokeWidth: CLAUDE_BADGE_FRAME.strokeWidth,
    },
    {
      d: CLAUDE_BADGE_LETTER.d,
      fill: "none",
      stroke: color,
      strokeWidth: CLAUDE_BADGE_LETTER.strokeWidth,
    },
  ];
}

// Every theme's foreground and muted foreground, light and dark, as callers pass them.
const themeForegrounds = Object.values(REGISTERED_THEMES).flatMap((theme) => [
  theme.colors.foreground,
  theme.colors.foregroundMuted,
]);

describe("the Claude text badge", () => {
  it("is what the built-in claude provider shows, in the caller's color at every icon size", () => {
    for (const size of Object.values(ICON_SIZE)) {
      for (const color of themeForegrounds) {
        const { props, shapes } = draw(getProviderIcon("claude"), size, color);

        expect(props).toMatchObject({ width: size, height: size, viewBox: CLAUDE_BADGE_VIEW_BOX });
        expect(shapes).toEqual([
          expect.objectContaining(badgeIn(color)[0]),
          expect.objectContaining(badgeIn(color)[1]),
        ]);
      }
    }
  });

  it("is what claude-acp shows, even when a host sends its own SVG for that id", () => {
    replaceProviderSnapshotIcons("server-1", [{ provider: "claude-acp", iconSvg: HOST_SVG }]);

    expect(resolveProviderIconName("claude-acp", "server-1")).toEqual({
      kind: "builtin",
      id: "claude",
    });
    expect(getProviderIcon("claude-acp", "server-1")).toBe(getProviderIcon("claude"));
  });

  it("is what claude-acp shows without any host SVG", () => {
    expect(getProviderIcon("claude-acp")).toBe(getProviderIcon("claude"));
  });

  it("is the vendored claude-acp icon too", () => {
    expect(ACP_PROVIDER_ICON_SVGS["claude-acp"]).toBe(CLAUDE_BADGE_SVG);
  });

  it("draws only in currentColor as SVG markup", () => {
    expect(CLAUDE_BADGE_SVG).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    expect(CLAUDE_BADGE_SVG.match(/(?:fill|stroke)="[^"]*"/g)).toEqual([
      'fill="none"',
      'stroke="currentColor"',
    ]);
  });
});
