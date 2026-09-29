import type { HostSectionSlug } from "@/utils/host-routes";

/**
 * woowtech smart: account usage (plan quota) stays hidden. Fetching it reads each provider's
 * saved credentials, so the daemon keeps it off (packages/server/src/server/
 * woowtech-provider-usage-policy.ts) and the App shows neither the host "Usage" page nor the
 * usage block of the context meter tooltip, and never asks a host for usage.
 * woowtech/README.md section 23 says how to turn it back on.
 */
export const PROVIDER_USAGE_VISIBLE: boolean = false;

/** The host settings sections to list: without "usage" while usage is hidden. */
export function visibleHostSections<T extends { id: HostSectionSlug }>(
  items: readonly T[],
  visible: boolean = PROVIDER_USAGE_VISIBLE,
): T[] {
  return visible ? [...items] : items.filter((item) => item.id !== "usage");
}

/** A host section route's section. A hidden "usage" reads as a section the App does not know. */
export function visibleHostSection(
  section: HostSectionSlug | null,
  visible: boolean = PROVIDER_USAGE_VISIBLE,
): HostSectionSlug | null {
  return !visible && section === "usage" ? null : section;
}
