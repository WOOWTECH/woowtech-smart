import { useCallback, useMemo, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";
import type { SettingsSectionSlug } from "@/utils/host-routes";
import { openExternalUrl } from "@/utils/open-external-url";
import {
  buildThirdPartyNotices,
  type NoticeLink,
  type NoticeRow,
} from "./woowtech-third-party-notices";

// woowtech smart: Settings > Trademarks and third-party notices (商標與第三方授權),
// woowtech/README.md sections 24 and 25. Every word comes from woowtech-third-party-notices.ts;
// this lays it out as settings cards on iOS, Android, the web and the desktop app alike. The text
// is selectable so a license link can be copied. A link an owner's brand rules ask for, such as
// JetBrains' link back to www.jetbrains.com, is a button that opens the owner's site.

const ThemedExternalLink = withUnistyles(ExternalLink);
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * The content of a settings section woowtech smart adds, for the section switch in
 * settings-screen.tsx to render in its default case; null for any other section.
 */
export function renderWoowtechSettingsSection(section: SettingsSectionSlug): ReactNode {
  return section === "notices" ? <ThirdPartyNoticesSection /> : null;
}

export function ThirdPartyNoticesSection() {
  const { t } = useTranslation();
  const sections = useMemo(() => buildThirdPartyNotices(t), [t]);

  return (
    <View testID="third-party-notices">
      {sections.map((section) => (
        <SettingsSection
          key={section.id}
          title={section.title}
          info={section.info}
          testID={`third-party-notices-${section.id}`}
        >
          <View style={settingsStyles.card}>
            {section.rows.map((row, index) => (
              <NoticeRowView key={row.key} row={row} bordered={index > 0} />
            ))}
          </View>
        </SettingsSection>
      ))}
    </View>
  );
}

function NoticeRowView({ row, bordered }: { row: NoticeRow; bordered: boolean }) {
  return (
    <View
      style={[settingsStyles.row, bordered && settingsStyles.rowBorder]}
      testID={`third-party-notice-${row.key}`}
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} selectable>
          {row.title}
        </Text>
        {row.lines.map((line) => (
          <Text key={line} style={settingsStyles.rowHint} selectable>
            {line}
          </Text>
        ))}
        {row.link ? <NoticeLinkView link={row.link} /> : null}
      </View>
    </View>
  );
}

function NoticeLinkView({ link }: { link: NoticeLink }) {
  const handleOpen = useCallback(() => {
    void openExternalUrl(link.url);
  }, [link.url]);

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={link.label}
      onPress={handleOpen}
      style={styles.link}
    >
      <Text style={styles.linkText}>{link.label}</Text>
      <ThemedExternalLink size={12} uniProps={foregroundMutedColorMapping} />
    </Pressable>
  );
}

// Laid out as the ACP catalog's install link (provider-catalog-list.tsx), with the row hint's
// spacing and type.
const styles = StyleSheet.create((theme) => ({
  link: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    maxWidth: "100%",
    marginTop: theme.spacing[1],
  },
  linkText: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
