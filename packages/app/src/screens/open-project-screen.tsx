import { useHosts, useHostRuntimeLastError } from "@/runtime/host-runtime";
import { useCallback, useEffect, useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { View, Text, Pressable, ScrollView, type LayoutChangeEvent } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useRouter } from "expo-router";
import { FolderOpen, Inbox, Plug, Smartphone } from "lucide-react-native";
import { PaseoLogo } from "@/components/icons/paseo-logo";
import { CommunityLinks } from "@/components/community-links";
import { MenuHeader } from "@/components/headers/menu-header";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { useImportSession } from "@/hooks/use-import-session";
import { useHostChooser } from "@/hosts/host-chooser";
import { usePanelStore } from "@/stores/panel-store";
import {
  useIsCompactFormFactor,
  HEADER_INNER_HEIGHT,
  HEADER_INNER_HEIGHT_MOBILE,
  HEADER_TOP_PADDING_MOBILE,
} from "@/constants/layout";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { PairDeviceModal } from "@/devices";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";
import { WINDOW_CONTENT_DATASET } from "@/components/desktop/titlebar-drag-region";
import { HOME_TILE_GAP, HOME_TILE_WIDTH, resolveHomeTileWidth } from "@/screens/open-project-tiles";

const HOME_TILES_MAX_WIDTH = 2 * HOME_TILE_WIDTH + HOME_TILE_GAP;

export function OpenProjectScreen() {
  const { t } = useTranslation();
  const hosts = useHosts();
  const router = useRouter();
  const openDesktopAgentList = usePanelStore((s) => s.openDesktopAgentList);
  const openProjectPicker = useOpenAddProject();
  const importSession = useImportSession();
  const chooseHost = useHostChooser();
  const localServerId = useLocalDaemonServerId();
  const [isPairDeviceOpen, setIsPairDeviceOpen] = useState(false);

  const isCompactLayout = useIsCompactFormFactor();
  const [measuredTileWidth, setMeasuredTileWidth] = useState<number>();
  const handleTilesLayout = useCallback((event: LayoutChangeEvent) => {
    setMeasuredTileWidth(resolveHomeTileWidth(event.nativeEvent.layout.width));
  }, []);
  const tileWidth = isCompactLayout ? undefined : measuredTileWidth;

  useEffect(() => {
    if (!isCompactLayout) {
      openDesktopAgentList();
    }
  }, [isCompactLayout, openDesktopAgentList]);

  const handleOpenPicker = useCallback(() => {
    void openProjectPicker();
  }, [openProjectPicker]);

  const handleOpenPairDevice = useCallback(() => setIsPairDeviceOpen(true), []);
  const handleClosePairDevice = useCallback(() => setIsPairDeviceOpen(false), []);

  const handleOpenProviders = useCallback(() => {
    chooseHost({
      title: "Choose host",
      onChooseHost: (serverId) => {
        router.push(buildSettingsHostSectionRoute(serverId, "providers"));
      },
    });
  }, [chooseHost, router]);

  return (
    <View style={styles.container}>
      <MenuHeader borderless />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        dataSet={WINDOW_CONTENT_DATASET}
      >
        <View style={styles.content}>
          <View style={styles.logo}>
            <PaseoLogo size={52} />
          </View>
          {hosts.map((host) => (
            <HostError key={host.serverId} serverId={host.serverId} label={host.label} />
          ))}
          <View style={styles.tiles} onLayout={handleTilesLayout}>
            <HomeTile
              icon={FolderOpen}
              title={t("openProject.tiles.addProject.title")}
              description={t("openProject.tiles.addProject.description")}
              onPress={handleOpenPicker}
              testID="open-project-submit"
              width={tileWidth}
              accent
            />
            <HomeTile
              icon={Inbox}
              title={t("openProject.tiles.importSession.title")}
              description={t("openProject.tiles.importSession.description")}
              onPress={importSession.open}
              testID="open-project-import-session"
              width={tileWidth}
            />
            <HomeTile
              icon={Plug}
              title={t("openProject.tiles.setupProviders.title")}
              description={t("openProject.tiles.setupProviders.description")}
              onPress={handleOpenProviders}
              testID="open-project-setup-providers"
              width={tileWidth}
            />
            {localServerId ? (
              <HomeTile
                icon={Smartphone}
                title={t("openProject.tiles.pairDevice.title")}
                description={t("openProject.tiles.pairDevice.description")}
                onPress={handleOpenPairDevice}
                testID="open-project-pair-device"
                width={tileWidth}
              />
            ) : null}
          </View>
        </View>
        <View style={styles.communityRow}>
          <CommunityLinks />
        </View>
      </ScrollView>
      <PairDeviceModal
        serverId={localServerId ?? ""}
        visible={isPairDeviceOpen}
        onClose={handleClosePairDevice}
        testID="open-project-pair-device-modal"
      />
      {importSession.sheet}
    </View>
  );
}

function HostError({ serverId, label }: { serverId: string; label: string }) {
  const error = useHostRuntimeLastError(serverId);
  return error ? (
    <Text accessibilityRole="alert" style={styles.hostError}>
      {label}: {error}
    </Text>
  ) : null;
}

interface HomeTileProps {
  icon: ComponentType<{ size: number; color: string }>;
  title: string;
  description: string;
  onPress: () => void;
  testID?: string;
  accent?: boolean;
  /** The measured width from the md breakpoint up; the stylesheet's width applies until then. */
  width?: number;
}

function HomeTile({
  icon: Icon,
  title,
  description,
  onPress,
  testID,
  accent,
  width,
}: HomeTileProps) {
  // useUnistyles is acceptable here: leaf component, off the hot path (home screen renders once).
  const { theme } = useUnistyles();
  const [hovered, setHovered] = useState(false);
  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);

  const iconColor = accent ? theme.colors.accent : theme.colors.foregroundMuted;

  const pressableStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.tile,
      width !== undefined && { width },
      hovered && styles.tileHovered,
      pressed && styles.tilePressed,
    ],
    [hovered, width],
  );

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      testID={testID}
      style={pressableStyle}
    >
      <Icon size={20} color={iconColor} />
      <View style={styles.tileText}>
        <Text style={styles.tileTitle}>{title}</Text>
        <Text style={styles.tileDescription}>{description}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
    userSelect: "none",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    position: "relative",
    flexGrow: 1,
    flexShrink: 0,
    justifyContent: { xs: "flex-start", md: "center" },
    alignItems: "center",
    gap: 0,
    padding: theme.spacing[6],
    paddingTop: { xs: theme.spacing[12], md: theme.spacing[6] },
  },
  logo: {
    marginBottom: theme.spacing[8],
  },
  hostError: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.base,
    maxWidth: HOME_TILES_MAX_WIDTH,
    textAlign: "center",
  },
  tiles: {
    marginTop: { xs: theme.spacing[6], md: theme.spacing[12] },
    width: "100%",
    maxWidth: HOME_TILES_MAX_WIDTH,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    gap: HOME_TILE_GAP,
  },
  tile: {
    width: { xs: "100%", md: HOME_TILE_WIDTH },
    minHeight: { xs: 0, md: 132 },
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.xl,
    gap: theme.spacing[3],
  },
  tileHovered: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.borderAccent,
  },
  tilePressed: {
    opacity: 0.85,
  },
  tileText: {
    gap: theme.spacing[1],
  },
  tileTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  tileDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    lineHeight: 18,
  },
  communityRow: {
    flexShrink: 0,
    paddingBottom: {
      xs: HEADER_INNER_HEIGHT_MOBILE + HEADER_TOP_PADDING_MOBILE + theme.spacing[2],
      md: HEADER_INNER_HEIGHT + theme.spacing[2],
    },
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 0,
  },
}));
