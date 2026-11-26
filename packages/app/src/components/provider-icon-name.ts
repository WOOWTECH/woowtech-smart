import {
  BUILTIN_PROVIDER_ICON_NAMES,
  KNOWN_PROVIDER_ICON_NAMES,
} from "@getpaseo/protocol/provider-icon-names";
import { isClaudeProviderId } from "./icons/claude-badge";

export type ProviderIconName =
  | { kind: "builtin"; id: string }
  | { kind: "catalog"; id: string }
  | { kind: "svg"; svg: string }
  | { kind: "bot" };

const BUILTIN_PROVIDER_IDS = new Set(BUILTIN_PROVIDER_ICON_NAMES);
const KNOWN_PROVIDER_IDS = new Set(KNOWN_PROVIDER_ICON_NAMES);
export function resolveProviderIconName(provider: string, iconSvg?: string): ProviderIconName {
  // Keep the catalog brand policy ahead of host-provided artwork.
  if (isClaudeProviderId(provider)) {
    return { kind: "builtin", id: "claude" };
  }
  if (BUILTIN_PROVIDER_IDS.has(provider)) {
    return { kind: "builtin", id: provider };
  }
  if (KNOWN_PROVIDER_IDS.has(provider)) {
    return { kind: "catalog", id: provider };
  }
  if (iconSvg) {
    return { kind: "svg", svg: iconSvg };
  }
  return { kind: "bot" };
}
