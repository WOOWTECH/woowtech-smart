import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import SettingsScreen from "@/screens/settings-screen";
import { normalizeHostSectionSlug } from "@/utils/host-routes";
import { visibleHostSection } from "@/provider-usage/woowtech-usage-visibility";

export default function SettingsHostSectionRoute() {
  const params = useLocalSearchParams<{ serverId?: string; hostSection?: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId.trim() : "";
  const rawSection = typeof params.hostSection === "string" ? params.hostSection : "";
  // woowtech smart: the hidden usage section opens the default one (woowtech/README.md §23).
  const section = visibleHostSection(normalizeHostSectionSlug(rawSection)) ?? "connections";
  const view = useMemo(() => ({ kind: "host" as const, serverId, section }), [serverId, section]);

  return (
    <HostRouteBootstrapBoundary>
      <SettingsScreen view={view} />
    </HostRouteBootstrapBoundary>
  );
}
