import type { ReactElement } from "react";
import { SvgXml } from "react-native-svg";
import { describe, expect, it } from "vitest";
import { ACP_PROVIDER_ICON_SVGS } from "@/assets/acp-provider-icons";
import { vendorBadgeSvg } from "@/components/icons/vendor-badge";
import { acpMarkIconAt } from "@/components/icons/woowtech-vendor-mark-icon";
import {
  NAMED_ROW,
  UNCHECKED_PLACE,
  drawsLogoAt,
  type VendorMarkPlace,
} from "@/components/icons/woowtech-vendor-mark-places";
import {
  ACP_ICON_STYLES,
  OFFICIAL_ACP_ICON_SVGS,
  type VendorMarkStyle,
} from "@/components/icons/woowtech-vendor-mark-styles.gen";
import { REGISTERED_THEMES, type Theme } from "@/styles/theme";
import { getProviderIcon } from "./provider-icons";

// woowtech smart shows some vendors' own logos again, each only where the app meets the vendor's
// conditions (woowtech/README.md section 25). A mark is coloured one of three ways: in the colour
// its place gives it (theme), pure black or white by the theme (mono), or in its own colours
// (original). A place the fork has not checked may dim its icon and may not name the provider, so
// there a mono or original mark, or one that may only appear beside its product's name, draws its
// text badge. The settings provider list and the ACP catalog name each provider beside an icon
// they never dim.

interface DrawnProps {
  xml?: string;
  width?: number;
  height?: number;
  color?: string;
  uniProps?: (theme: Theme) => { xml?: string; color?: string };
}

const CALLER_COLORS = ["#666666", "#111111", "currentColor"];
const HOST = "server-1";

function drawProvider(provider: string, color: string, place?: VendorMarkPlace) {
  const Icon = getProviderIcon(provider, HOST, place) as unknown as (props: {
    size: number;
    color: string;
  }) => ReactElement<DrawnProps>;
  return Icon({ size: 20, color });
}

/**
 * What a drawn icon shows on each registered theme: its SVG and the colour it fills. Unistyles'
 * withUnistyles merges the theme's props under the ones the element passes itself, so a prop the
 * element sets wins over the theme's (react-native-unistyles deepMergeObjects(uniProps, props)).
 */
function onEveryTheme(element: ReactElement<DrawnProps>) {
  const { uniProps, ...passed } = element.props;
  return Object.entries(REGISTERED_THEMES).map(([name, theme]) => {
    const themed = { ...uniProps?.(theme), ...passed };
    return { name, scheme: theme.colorScheme, xml: themed.xml, color: themed.color };
  });
}

describe("where a vendor mark may show its logo", () => {
  const theme: VendorMarkStyle = { color: "theme" };
  const mono: VendorMarkStyle = { color: "mono" };
  const original: VendorMarkStyle = { color: "original" };
  const googleLike: VendorMarkStyle = { color: "original", onlyBesideName: true };
  const nameBesideButDims: VendorMarkPlace = { nameBeside: true, keepsColors: false };

  it("draws a theme mark anywhere, in the colour its place gives it", () => {
    expect(drawsLogoAt(theme, UNCHECKED_PLACE)).toBe(true);
    expect(drawsLogoAt(theme, NAMED_ROW)).toBe(true);
    expect(drawsLogoAt(theme, nameBesideButDims)).toBe(true);
  });

  it("draws a mono or original mark only where the place never dims or tints it", () => {
    for (const style of [mono, original]) {
      expect(drawsLogoAt(style, UNCHECKED_PLACE)).toBe(false);
      expect(drawsLogoAt(style, nameBesideButDims)).toBe(false);
      expect(drawsLogoAt(style, NAMED_ROW)).toBe(true);
    }
  });

  it("draws a mark that may only appear beside its name only where the place names the product", () => {
    expect(drawsLogoAt(googleLike, UNCHECKED_PLACE)).toBe(false);
    expect(drawsLogoAt(googleLike, { nameBeside: false, keepsColors: true })).toBe(false);
    expect(drawsLogoAt(googleLike, NAMED_ROW)).toBe(true);
    expect(drawsLogoAt({ color: "theme", onlyBesideName: true }, nameBesideButDims)).toBe(true);
  });

  it("calls a place it knows nothing about unchecked, and the settings and catalog rows named", () => {
    expect(UNCHECKED_PLACE).toEqual({ nameBeside: false, keepsColors: false });
    expect(NAMED_ROW).toEqual({ nameBeside: true, keepsColors: true });
  });
});

describe("a Google product icon, once its logo is cleared", () => {
  // No Google mark shows its logo yet (woowtech/vendor-marks.mjs). Google asks that its product
  // icons never stand on their own, so in an agent row, a workspace tab or a schedule row, which
  // show a conversation's or schedule's title, the mark draws its badge.
  const style: VendorMarkStyle = { color: "original", onlyBesideName: true };
  const svg = '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="#4285F4"/></svg>';

  it("draws its badge where its name is not beside it", () => {
    const Icon = acpMarkIconAt("gemini", svg, UNCHECKED_PLACE, style) as unknown as (props: {
      size: number;
      color: string;
    }) => ReactElement<DrawnProps>;
    expect(Icon({ size: 16, color: "#666666" })).toMatchObject({
      type: SvgXml,
      props: { xml: vendorBadgeSvg("gemini"), width: 16, height: 16, color: "#666666" },
    });
  });

  it("draws its own file in its own colours where its name is beside it", () => {
    const Icon = acpMarkIconAt("gemini", svg, NAMED_ROW, style) as unknown as (props: {
      size: number;
      color: string;
    }) => ReactElement<DrawnProps>;
    const drawn = Icon({ size: 16, color: "#666666" });
    expect(drawn).toMatchObject({ type: SvgXml, props: { xml: svg, width: 16, height: 16 } });
    expect(onEveryTheme(drawn).every(({ xml, color }) => xml === svg && color === undefined)).toBe(
      true,
    );
  });
});

describe("the vendor marks the app ships", () => {
  it("styles every ACP icon that shows its logo, and no badge", () => {
    for (const id of Object.keys(ACP_ICON_STYLES)) {
      expect({ id, badge: ACP_PROVIDER_ICON_SVGS[id as never] === vendorBadgeSvg(id) }).toEqual({
        id,
        badge: false,
      });
    }
  });

  it("draws Junie's registry icon everywhere, in the colour its place gives it", () => {
    expect(ACP_ICON_STYLES.junie).toEqual({ color: "theme" });
    for (const place of [undefined, UNCHECKED_PLACE, NAMED_ROW]) {
      for (const color of CALLER_COLORS) {
        expect(drawProvider("junie", color, place)).toMatchObject({
          type: SvgXml,
          props: { xml: ACP_PROVIDER_ICON_SVGS.junie, width: 20, height: 20, color },
        });
      }
    }
  });

  it("draws Cursor's cube pure black on light themes and pure white on dark ones in the named rows", () => {
    expect(ACP_ICON_STYLES.cursor).toEqual({ color: "mono" });
    for (const color of CALLER_COLORS) {
      const drawn = drawProvider("cursor", color, NAMED_ROW);
      expect(drawn).toMatchObject({
        type: SvgXml,
        props: { xml: ACP_PROVIDER_ICON_SVGS.cursor, width: 20, height: 20 },
      });
      // The colour its place asks for never reaches the drawing.
      expect(drawn.props.color).toBeUndefined();
      for (const shown of onEveryTheme(drawn)) {
        expect(shown).toEqual({
          ...shown,
          xml: ACP_PROVIDER_ICON_SVGS.cursor,
          color: shown.scheme === "light" ? "#000000" : "#FFFFFF",
        });
      }
    }
  });

  it("draws SpaceXAI's own Grok files, the dark one on light themes and the white one on dark ones", () => {
    const style = ACP_ICON_STYLES.grok;
    expect(style?.color).toBe("mono");
    expect(ACP_PROVIDER_ICON_SVGS.grok).toBe(OFFICIAL_ACP_ICON_SVGS.grok);
    expect(OFFICIAL_ACP_ICON_SVGS.grok).toContain('fill="#0A0A0A"');
    expect(style?.onDark).toContain('fill="white"');
    for (const color of CALLER_COLORS) {
      const drawn = drawProvider("grok", color, NAMED_ROW);
      expect(drawn.props).toMatchObject({ width: 20, height: 20 });
      // Neither the file nor a colour is passed: the theme picks the file, so a passed one could
      // not win over it.
      expect(drawn.props.xml).toBeUndefined();
      expect(drawn.props.color).toBeUndefined();
      for (const shown of onEveryTheme(drawn)) {
        expect(shown).toEqual({
          ...shown,
          xml: shown.scheme === "light" ? OFFICIAL_ACP_ICON_SVGS.grok : style?.onDark,
          color: undefined,
        });
      }
    }
  });

  it("draws the badge for Cursor and Grok where a place may dim them or does not name them", () => {
    for (const provider of ["cursor", "grok"]) {
      for (const place of [undefined, UNCHECKED_PLACE, { nameBeside: true, keepsColors: false }]) {
        for (const color of CALLER_COLORS) {
          expect(drawProvider(provider, color, place)).toMatchObject({
            type: SvgXml,
            props: { xml: vendorBadgeSvg(provider), width: 20, height: 20, color },
          });
        }
      }
    }
  });
});
