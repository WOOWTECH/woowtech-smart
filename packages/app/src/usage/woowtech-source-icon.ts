import { findSvgIconProblem } from "@getpaseo/plugin";
import { ACP_PROVIDER_ICON_SVGS } from "../assets/acp-provider-icons";
import { VENDOR_MONOGRAMS, vendorBadgeSvg } from "../components/icons/vendor-badge";

const SOURCE_ICON_IDS = new Map([
  ["antigravity", "agy"],
  ["claude", "claude-acp"],
  ["codex", "codex-acp"],
  ["copilot", "github-copilot-cli"],
  ["minimax", "minimax-code"],
  ["opencode-go", "opencode"],
  ["zai", "glm-acp-agent"],
]);
const catalogIcons: Readonly<Record<string, string | undefined>> = ACP_PROVIDER_ICON_SVGS;

/** Known sources keep the fork's artwork; custom plugin sources may supply a validated SVG. */
export function curatedUsageSourceIcon(sourceId: string, svg?: string | null): string | null {
  const iconId = SOURCE_ICON_IDS.get(sourceId) ?? sourceId;
  if (Object.hasOwn(catalogIcons, iconId)) return catalogIcons[iconId] ?? null;
  if (Object.hasOwn(VENDOR_MONOGRAMS, iconId)) return vendorBadgeSvg(iconId);
  return svg && findSvgIconProblem(svg) === null ? svg : null;
}
