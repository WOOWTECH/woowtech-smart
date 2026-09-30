import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import Svg from "react-native-svg";
import { describe, expect, it } from "vitest";
import { CodebergIcon } from "@/components/icons/codeberg-icon";
import { ForgejoIcon } from "@/components/icons/forgejo-icon";
import { GiteaIcon } from "@/components/icons/gitea-icon";
import { GitHubIcon } from "@/components/icons/github-icon";
import { GitLabIcon } from "@/components/icons/gitlab-icon";
import {
  VENDOR_BADGE_VIEW_BOX,
  vendorBadgeDrawing,
  vendorMonogram,
} from "@/components/icons/vendor-badge";
import { REGISTERED_THEMES, type Theme } from "@/styles/theme";
import { getForgeBrandColorMapping, getForgeIconComponent } from "./forge-icon";

// woowtech smart's git forge marks (woowtech/README.md section 24). GitLab's guidelines do not
// permit its logo, so GitLab shows the neutral text badge. GitHub and Codeberg allow their logos
// only in black or white, untinted, so they draw pure black on light themes and pure white on dark
// themes, whatever colour the place that draws them asks for. Gitea and Forgejo stay as upstream
// draws them.

interface Props {
  size?: number;
  color?: string;
  [key: string]: unknown;
}
type ThemeMapping = (theme: Theme) => { color: string };

interface DrawnShape {
  d?: string;
  fill?: string;
  stroke?: string;
}

function draw(Component: unknown, props: Props): ReactElement {
  if (typeof Component !== "function") throw new Error("Expected a function component");
  return (Component as (props: Props) => ReactElement)(props);
}

/** The element a component finally hands to react-native-svg's <Svg>. */
function svgOf(Icon: unknown, props: Props): ReactElement {
  let element = draw(Icon, props);
  while (element.type !== Svg) {
    element = draw(element.type, element.props as Props);
  }
  return element;
}

function shapesOf(svg: ReactElement): DrawnShape[] {
  const { children } = svg.props as { children?: ReactNode };
  return Children.toArray(children).map((shape) =>
    isValidElement<DrawnShape>(shape) ? shape.props : {},
  );
}

// The colours the places that draw a forge mark pass it: muted and full foreground, GitLab's and
// Codeberg's brand colours, and nothing at all.
const CALLER_COLORS = [undefined, "#666666", "#111111", "#FC6D26", "#2185D0", "currentColor"];

describe("the GitLab forge mark", () => {
  it("is the neutral text badge Gl, not the tanuki", () => {
    expect(vendorMonogram("gitlab")).toBe("Gl");
    const svg = svgOf(GitLabIcon, { size: 16, color: "#123456" });
    expect(svg.props).toMatchObject({ width: 16, height: 16, viewBox: VENDOR_BADGE_VIEW_BOX });
    const shapes = shapesOf(svg);
    expect(shapes.map((shape) => shape.stroke)).toEqual(["#123456", "#123456"]);
    expect(shapes[1]?.d).toBe(vendorBadgeDrawing("Gl").letters?.d);
    expect(getForgeIconComponent("gitlab")).toBe(GitLabIcon);
  });

  it("draws in the caller's colour, never GitLab's orange", () => {
    expect(getForgeBrandColorMapping("gitlab")).toBeNull();
  });
});

describe("the GitHub and Codeberg forge marks", () => {
  const marks = { github: GitHubIcon, codeberg: CodebergIcon };

  for (const [forge, Icon] of Object.entries(marks)) {
    it(`${forge} draws pure black on light themes and pure white on dark themes, whatever colour it is given`, () => {
      expect(getForgeIconComponent(forge)).toBe(Icon);
      for (const color of CALLER_COLORS) {
        const mark = draw(Icon, { size: 16, color });
        const { uniProps, ...props } = mark.props as Props & { uniProps: ThemeMapping };
        // The caller's colour does not reach the drawing; the theme picks it.
        expect({ color, passed: props.color }).toEqual({ color, passed: undefined });
        for (const [name, theme] of Object.entries(REGISTERED_THEMES)) {
          expect({ name, fill: uniProps(theme).color }).toEqual({
            name,
            fill: theme.colorScheme === "light" ? "#000000" : "#FFFFFF",
          });
        }
        for (const fill of ["#000000", "#FFFFFF"]) {
          const svg = svgOf(mark.type, { ...props, color: fill });
          expect(svg.props).toMatchObject({ width: 16, height: 16, fill });
          expect(shapesOf(svg).map((shape) => shape.fill)).toEqual([undefined]);
        }
      }
    });

    it(`${forge} is never tinted with a brand colour`, () => {
      expect(getForgeBrandColorMapping(forge)).toBeNull();
    });
  }
});

describe("the Gitea and Forgejo forge marks", () => {
  it("keep upstream's icons and brand colours", () => {
    for (const [forge, Icon] of Object.entries({ gitea: GiteaIcon, forgejo: ForgejoIcon })) {
      expect(getForgeIconComponent(forge)).toBe(Icon);
      expect(getForgeBrandColorMapping(forge)).toBeTypeOf("function");
    }
  });
});
