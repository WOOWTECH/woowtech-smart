import { useMemo } from "react";
import { PluginClientStateProvider } from "@getpaseo/plugin/client/host";
import type { PluginTheme } from "@getpaseo/plugin";
import { withUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { usePaneContext } from "@/panels/pane-context";
import { useHostRuntimeClient, useHosts } from "@/runtime/host-runtime";
import { createPluginClientStateSource } from "@/plugins/client-state/source";
import { usePluginHostNavigation } from "@/plugins/host-navigation";
import { PluginRuntimeBoundary } from "@/plugins/runtime-boundary";
import { SurfaceErrorBoundary } from "@/plugins/surface-error-boundary";
import { Platform } from "react-native";
import { toPluginTheme } from "@/plugins/theme";
import type { Theme } from "@/styles/theme";
import type { BuiltinFilePanelProps, PluginFilePanel } from "./panels";

type Props = Pick<BuiltinFilePanelProps, "file" | "tab" | "location"> & { panel: PluginFilePanel };

function PluginHost({ panel, file, tab, location, theme }: Props & { theme: PluginTheme }) {
  const { workspaceId } = usePaneContext();
  const { plugin, contribution } = panel;
  const serverId = plugin.serverId;
  const client = useHostRuntimeClient(serverId);
  const compact = useIsCompactFormFactor();
  const hosts = useHosts();
  const navigation = usePluginHostNavigation(serverId);
  const stateSource = useMemo(() => createPluginClientStateSource(serverId), [serverId]);
  const hostLabel = hosts.find((host) => host.serverId === serverId)?.label ?? serverId;
  const host = useMemo(() => ({ id: serverId, label: hostLabel }), [serverId, hostLabel]);
  const platform: "ios" | "android" | "web" =
    Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web";
  const layout = useMemo(() => ({ compact, platform }), [compact, platform]);
  const Component = contribution.Component;
  if (!client) return null;
  return (
    <SurfaceErrorBoundary installation={plugin} Surface={Component} key={panel.id}>
      <PluginRuntimeBoundary plugin={plugin} client={client}>
        <PluginClientStateProvider source={stateSource}>
          <Component
            theme={theme}
            host={host}
            layout={layout}
            navigation={navigation}
            workspaceId={workspaceId}
            file={file}
            tab={tab}
            location={location}
          />
        </PluginClientStateProvider>
      </PluginRuntimeBoundary>
    </SurfaceErrorBoundary>
  );
}
const ThemedHost = withUnistyles(PluginHost);
const themeMapping = (theme: Theme) => ({ theme: toPluginTheme(theme) });
export function PluginFilePanelHost(props: Props) {
  return <ThemedHost {...props} uniProps={themeMapping} />;
}
