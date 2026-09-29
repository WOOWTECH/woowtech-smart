import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { SvgXml } from "react-native-svg";
import { describe, expect, it } from "vitest";
import { ACP_PROVIDER_ICON_SVGS } from "@/assets/acp-provider-icons";
import { ACP_PROVIDER_CATALOG } from "@/data/acp-provider-catalog";
import {
  VENDOR_BADGE_FRAME,
  VENDOR_BADGE_VIEW_BOX,
  VENDOR_MONOGRAMS,
  vendorBadgeDrawing,
  vendorBadgeSvg,
  vendorMonogram,
} from "@/components/icons/vendor-badge";
import { createVendorBadgeIcon } from "@/components/icons/vendor-badge-icon";
import { ICON_SIZE, darkTheme, lightTheme } from "@/styles/theme";
import { replaceProviderSnapshotIcons, resolveProviderIconName } from "./provider-icon-name";
import { getProviderIcon } from "./provider-icons";

interface DrawnShape {
  d?: string;
  x?: number;
  rx?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

type IconComponent = (props: { size: number; color: string }) => ReactElement;

/** What an icon component draws at `size` in `color`: its SVG props and each shape's props. */
function draw(Icon: unknown, size: number, color: string) {
  if (typeof Icon !== "function") throw new Error("Expected a function component");
  const svg = (Icon as IconComponent)({ size, color });
  const { children, ...props } = svg.props as { children?: ReactNode; [key: string]: unknown };
  const shapes = Children.toArray(children).map((shape) =>
    isValidElement<DrawnShape>(shape) ? shape.props : {},
  );
  return { props, shapes };
}

const ALL_MONOGRAMS = [...new Set(Object.values(VENDOR_MONOGRAMS))];
const UPPERCASE = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
const LOWERCASE = [..."abcdefghijklmnopqrstuvwxyz"];
// Every monogram the badge can draw: a capital, alone or with a small letter.
const EVERY_MONOGRAM = [
  ...UPPERCASE,
  ...UPPERCASE.flatMap((upper) => LOWERCASE.map((lower) => upper + lower)),
];

// Inside the frame's stroke, with a clear margin on every side.
const frameInside = {
  left: VENDOR_BADGE_FRAME.x + VENDOR_BADGE_FRAME.strokeWidth / 2,
  top: VENDOR_BADGE_FRAME.y + VENDOR_BADGE_FRAME.strokeWidth / 2,
  right: VENDOR_BADGE_FRAME.x + VENDOR_BADGE_FRAME.width - VENDOR_BADGE_FRAME.strokeWidth / 2,
  bottom: VENDOR_BADGE_FRAME.y + VENDOR_BADGE_FRAME.height - VENDOR_BADGE_FRAME.strokeWidth / 2,
};
const MARGIN = 0.8;

describe("vendor monograms", () => {
  it("names each vendor with one or two letters of its name", () => {
    expect({
      claude: vendorMonogram("claude"),
      "claude-acp": vendorMonogram("claude-acp"),
      codex: vendorMonogram("codex"),
      "codex-acp": vendorMonogram("codex-acp"),
      copilot: vendorMonogram("copilot"),
      "github-copilot-cli": vendorMonogram("github-copilot-cli"),
      gemini: vendorMonogram("gemini"),
      cursor: vendorMonogram("cursor"),
      opencode: vendorMonogram("opencode"),
      pi: vendorMonogram("pi"),
      vscode: vendorMonogram("vscode"),
      zed: vendorMonogram("zed"),
    }).toEqual({
      claude: "C",
      "claude-acp": "C",
      codex: "Cx",
      "codex-acp": "Cx",
      copilot: "Gh",
      "github-copilot-cli": "Gh",
      gemini: "Ge",
      cursor: "Cu",
      opencode: "Oc",
      pi: "Pi",
      vscode: "Vs",
      zed: "Z",
    });
    for (const monogram of ALL_MONOGRAMS) {
      expect(monogram).toMatch(/^[A-Z][a-z]?$/);
    }
  });

  it("gives an id without a curated monogram the first letter of the id", () => {
    expect(vendorMonogram("direct-example")).toBe("D");
    expect(vendorMonogram("7-zip-agent")).toBe("Z");
    expect(vendorMonogram("constructor")).toBe("C");
    expect(vendorMonogram("__proto__")).toBe("P");
    expect(vendorMonogram("代理")).toBe("");
  });
});

describe("the vendor badge drawing", () => {
  it("fits every letter pair inside the frame with its strokes and a margin", () => {
    const outside = EVERY_MONOGRAM.filter((monogram) => {
      const { letters } = vendorBadgeDrawing(monogram);
      if (!letters) return true;
      const half = letters.strokeWidth / 2;
      return (
        letters.box.left - half < frameInside.left + MARGIN ||
        letters.box.right + half > frameInside.right - MARGIN ||
        letters.box.top - half < frameInside.top + MARGIN ||
        letters.box.bottom + half > frameInside.bottom - MARGIN
      );
    });
    expect(outside).toEqual([]);
  });

  it("keeps the letters large and heavy enough to read at 12 px", () => {
    // At 12 px one viewBox unit is half a pixel: capitals at least 3.5 px tall, strokes at
    // least 0.9 px wide.
    for (const monogram of EVERY_MONOGRAM) {
      const { letters } = vendorBadgeDrawing(monogram);
      expect({ monogram, capHeight: letters && letters.capHeight >= 7 }).toEqual({
        monogram,
        capHeight: true,
      });
      expect({ monogram, stroke: letters && letters.strokeWidth >= 1.8 }).toEqual({
        monogram,
        stroke: true,
      });
    }
  });

  it("centres the letters in the frame", () => {
    for (const monogram of ["C", "Cx", "Gh", "Mm", "Z"]) {
      const { letters } = vendorBadgeDrawing(monogram);
      if (!letters) throw new Error(`no letters for ${monogram}`);
      expect((letters.box.left + letters.box.right) / 2).toBeCloseTo(12, 5);
      expect(letters.box.top + letters.capHeight / 2).toBeCloseTo(12, 5);
    }
  });

  it("draws only the frame for an empty monogram", () => {
    expect(vendorBadgeDrawing("").letters).toBeNull();
    expect(vendorBadgeSvg("代理")).not.toContain("<path");
  });

  it("refuses anything but one capital and an optional small letter", () => {
    for (const monogram of ["CX", "cx", "Cxy", "C1", "É"]) {
      expect(() => vendorBadgeDrawing(monogram)).toThrow(monogram);
    }
  });
});

describe("the vendor badge SVG", () => {
  it("draws the frame and the monogram in currentColor", () => {
    const { letters } = vendorBadgeDrawing("Cx");
    const frame = VENDOR_BADGE_FRAME;
    expect(vendorBadgeSvg("codex")).toBe(
      [
        `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="${VENDOR_BADGE_VIEW_BOX}" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">`,
        `  <rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="${frame.rx}" stroke-width="${frame.strokeWidth}"/>`,
        `  <path d="${letters?.d}" stroke-width="${letters?.strokeWidth}"/>`,
        "</svg>",
        "",
      ].join("\n"),
    );
  });

  it("has no colour of its own", () => {
    for (const vendor of Object.keys(VENDOR_MONOGRAMS)) {
      const svg = vendorBadgeSvg(vendor);
      expect(svg).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/i);
      expect(svg.match(/(?:fill|stroke)="[^"]*"/g)).toEqual([
        'fill="none"',
        'stroke="currentColor"',
      ]);
    }
  });
});

describe("the vendor badge icon", () => {
  // The foreground a provider row passes, on the light and the dark theme.
  const themes = { light: lightTheme.colors.foreground, dark: darkTheme.colors.foreground };

  it("draws the monogram in the caller's colour on both themes at every icon size", () => {
    for (const vendor of ["claude", "codex", "copilot", "gemini", "cursor"]) {
      const Icon = createVendorBadgeIcon(vendor);
      const { letters } = vendorBadgeDrawing(vendorMonogram(vendor));
      for (const size of Object.values(ICON_SIZE)) {
        for (const color of Object.values(themes)) {
          const { props, shapes } = draw(Icon, size, color);
          expect(props).toMatchObject({
            width: size,
            height: size,
            viewBox: VENDOR_BADGE_VIEW_BOX,
          });
          expect(shapes).toEqual([
            expect.objectContaining({
              x: VENDOR_BADGE_FRAME.x,
              rx: VENDOR_BADGE_FRAME.rx,
              fill: "none",
              stroke: color,
              strokeWidth: VENDOR_BADGE_FRAME.strokeWidth,
            }),
            expect.objectContaining({
              d: letters?.d,
              fill: "none",
              stroke: color,
              strokeWidth: letters?.strokeWidth,
            }),
          ]);
        }
      }
    }
  });

  it("shows different letters for vendors that sit side by side in the model picker", () => {
    const pickerVendors = ["claude", "codex", "copilot", "opencode", "pi", "omp", "minimax"];
    const drawn = pickerVendors.map(
      (vendor) => vendorBadgeDrawing(vendorMonogram(vendor)).letters?.d,
    );
    expect(new Set(drawn).size).toBe(pickerVendors.length);
  });
});

describe("vendor icons across the app", () => {
  // A host can send its own SVG for any provider id, such as a plugin provider's icon. It can be
  // any vendor's logo, so it must never reach the screen. Which vendors show their badge and which
  // their upstream logo is woowtech/vendor-marks.mjs's decision, checked by woowtech/claude-badge.test.mjs.
  const HOST_SVG = '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z" /></svg>';
  const color = darkTheme.colors.foreground;

  function render(provider: string) {
    const Icon = getProviderIcon(provider, "server-1") as IconComponent;
    return Icon({ size: 16, color }) as ReactElement<{ xml: string }>;
  }

  it("draws an ACP catalog provider's own icon, never the SVG a host sends for it", () => {
    const withIcons = ACP_PROVIDER_CATALOG.filter((entry) => entry.iconSvg);
    replaceProviderSnapshotIcons(
      "server-1",
      withIcons.map((entry) => ({ provider: entry.id, iconSvg: HOST_SVG })),
    );
    for (const entry of withIcons) {
      expect(resolveProviderIconName(entry.id, "server-1")).toEqual({
        kind: "catalog",
        id: entry.id,
      });
      expect(render(entry.id)).toMatchObject({
        type: SvgXml,
        props: { xml: entry.iconSvg, width: 16, height: 16, color },
      });
    }
  });

  it("draws a host's SVG for any other provider as its badge", () => {
    replaceProviderSnapshotIcons("server-1", [
      { provider: "direct-example", iconSvg: HOST_SVG },
      { provider: "codex-acp", iconSvg: HOST_SVG },
    ]);

    expect(render("direct-example")).toMatchObject({
      type: SvgXml,
      props: { xml: vendorBadgeSvg("direct-example"), width: 16, height: 16, color },
    });
    expect(vendorBadgeSvg("direct-example")).toContain(`d="${vendorBadgeDrawing("D").letters?.d}"`);
    expect(render("codex-acp").props.xml).toBe(vendorBadgeSvg("codex"));
    expect(render("direct-example").props.xml).not.toContain("M4 4h16v16H4z");
  });

  it("gives every vendored ACP icon a curated monogram", () => {
    const uncurated = Object.keys(ACP_PROVIDER_ICON_SVGS).filter((id) => !(id in VENDOR_MONOGRAMS));
    expect(uncurated).toEqual([]);
  });
});
