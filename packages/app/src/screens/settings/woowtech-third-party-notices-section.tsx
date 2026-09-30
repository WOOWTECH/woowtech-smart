import { useMemo, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import type { SettingsSectionSlug } from "@/utils/host-routes";
import { buildThirdPartyNotices, type NoticeRow } from "./woowtech-third-party-notices";

// woowtech smart: Settings > Trademarks and third-party notices (商標與第三方授權),
// woowtech/README.md section 24. Every word comes from woowtech-third-party-notices.ts; this lays it
// out as settings cards on iOS, Android, the web and the desktop app alike. The text is selectable
// so a license link can be copied.

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
      </View>
    </View>
  );
}
