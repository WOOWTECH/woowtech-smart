import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { withUnistyles } from "react-native-unistyles";
import { ExternalLink } from "lucide-react-native";
import { BRAND_LINKS } from "@getpaseo/protocol/brand-links";
import { settingsStyles } from "@/styles/settings";
import { openExternalUrl } from "@/utils/open-external-url";

// woowtech smart: Settings > About links the privacy policy, which Apple (App Store Review
// Guideline 5.1.1) and Google Play want reachable inside the app (woowtech/README.md, section 10).
const ThemedExternalLink = withUnistyles(ExternalLink, (theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
}));

export function WoowtechPrivacyPolicyRow() {
  const { t, i18n } = useTranslation();
  // A brand can keep its Chinese policy at its own address (Apporo smart does; woowtech smart's
  // one post holds both languages).
  const isChinese = i18n.language === "zh" || i18n.language.startsWith("zh-");
  const policyUrl = isChinese ? BRAND_LINKS.privacyPolicyZh : BRAND_LINKS.privacyPolicy;
  const handlePress = useCallback(() => {
    void openExternalUrl(policyUrl);
  }, [policyUrl]);

  return (
    <Pressable
      style={[settingsStyles.row, settingsStyles.rowBorder]}
      onPress={handlePress}
      accessibilityRole="link"
      testID="settings-privacy-policy"
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("woowtech.privacyPolicy.title")}</Text>
        <Text style={settingsStyles.rowHint}>{t("woowtech.privacyPolicy.hint")}</Text>
      </View>
      <ThemedExternalLink />
    </Pressable>
  );
}
