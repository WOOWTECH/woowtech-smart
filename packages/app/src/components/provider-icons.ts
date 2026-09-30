import { Bot, PackagePlus } from "lucide-react-native";
import { createElement, type ComponentType } from "react";
import { SvgXml } from "react-native-svg";
import { ClaudeIcon } from "@/components/icons/claude-icon";
import { CodexIcon } from "@/components/icons/codex-icon";
import { CopilotIcon } from "@/components/icons/copilot-icon";
import { MiniMaxIcon } from "@/components/icons/minimax-icon";
import { OpenCodeIcon } from "@/components/icons/opencode-icon";
import { OmpIcon } from "@/components/icons/omp-icon";
import { PiIcon } from "@/components/icons/pi-icon";
import { ACP_PROVIDER_CATALOG } from "@/data/acp-provider-catalog";
import { resolveProviderIconName } from "@/components/provider-icon-name";
import { vendorBadgeSvg } from "@/components/icons/vendor-badge";
import { acpMarkIconAt } from "@/components/icons/woowtech-vendor-mark-icon";
import {
  UNCHECKED_PLACE,
  vendorMarkPlaceKey,
  type VendorMarkPlace,
} from "@/components/icons/woowtech-vendor-mark-places";

export interface ProviderIconProps {
  size: number;
  color: string;
}

export type ProviderIconComponent = ComponentType<ProviderIconProps>;

const BUILTIN_PROVIDER_ICONS: Record<string, ProviderIconComponent> = {
  claude: ClaudeIcon as unknown as ProviderIconComponent,
  codex: CodexIcon as unknown as ProviderIconComponent,
  copilot: CopilotIcon as unknown as ProviderIconComponent,
  kiro: PackagePlus,
  minimax: MiniMaxIcon as unknown as ProviderIconComponent,
  omp: OmpIcon as unknown as ProviderIconComponent,
  opencode: OpenCodeIcon as unknown as ProviderIconComponent,
  pi: PiIcon as unknown as ProviderIconComponent,
};

const CATALOG_ICON_SVGS = new Map(
  ACP_PROVIDER_CATALOG.flatMap((entry) => (entry.iconSvg ? [[entry.id, entry.iconSvg]] : [])),
);

const catalogIconComponents = new Map<string, ProviderIconComponent>();
const snapshotIconComponents = new Map<string, { svg: string; component: ProviderIconComponent }>();

function createSvgIcon(provider: string, iconSvg: string): ProviderIconComponent {
  const SvgProviderIcon: ProviderIconComponent = ({ size, color }) =>
    createElement(SvgXml, {
      xml: iconSvg,
      width: size,
      height: size,
      color,
    });
  SvgProviderIcon.displayName = `SvgProviderIcon(${provider})`;
  return SvgProviderIcon;
}

function getCatalogProviderIcon(provider: string, place: VendorMarkPlace): ProviderIconComponent {
  // woowtech smart: a vendor mark with conditions draws its logo only where its place meets them,
  // and its badge elsewhere (woowtech/README.md §25).
  const cacheKey = vendorMarkPlaceKey(provider, place);
  const cached = catalogIconComponents.get(cacheKey);
  if (cached) {
    return cached;
  }
  const iconSvg = CATALOG_ICON_SVGS.get(provider);
  if (!iconSvg) {
    return Bot;
  }
  const icon = acpMarkIconAt(provider, iconSvg, place) ?? createSvgIcon(provider, iconSvg);
  catalogIconComponents.set(cacheKey, icon);
  return icon;
}

function getSnapshotProviderIcon(provider: string, svg: string): ProviderIconComponent {
  const cached = snapshotIconComponents.get(provider);
  if (cached?.svg === svg) return cached.component;
  const component = createSvgIcon(provider, svg);
  snapshotIconComponents.set(provider, { svg, component });
  return component;
}

export function getProviderIcon(
  provider: string,
  serverId?: string | null,
  // woowtech smart: where the icon is drawn. Only a place checked to name the provider beside an
  // icon it never dims says so; see woowtech-vendor-mark-icon.tsx.
  place: VendorMarkPlace = UNCHECKED_PLACE,
): ProviderIconComponent {
  const name = resolveProviderIconName(provider, serverId);
  if (name.kind === "builtin") {
    return BUILTIN_PROVIDER_ICONS[name.id];
  }
  if (name.kind === "catalog") {
    return getCatalogProviderIcon(name.id, place);
  }
  if (name.kind === "svg") {
    // woowtech smart: a host's SVG can be any vendor's logo, so it draws as a text badge instead:
    // the vendor's monogram, or the id's first letter (woowtech/README.md §22).
    return getSnapshotProviderIcon(`${serverId}:${provider}`, vendorBadgeSvg(provider));
  }
  return Bot;
}
