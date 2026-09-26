import { useCallback } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Globe } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { BRAND_LINKS } from "@getpaseo/protocol/brand-links";
import { Button } from "@/components/ui/button";
import { openExternalUrl } from "@/utils/open-external-url";

// Upstream's row also stars and sponsors Paseo on GitHub. Ours leads only to
// WoowTech's website, labelled as in the help menu.
export function CommunityLinks() {
  const { t } = useTranslation();

  const handleOpenCommunity = useCallback(() => {
    void openExternalUrl(BRAND_LINKS.website);
  }, []);

  return (
    <View style={styles.row}>
      <Button
        variant="ghost"
        size="sm"
        leftIcon={Globe}
        onPress={handleOpenCommunity}
        testID="community-links-website"
      >
        {t("sidebar.help.discord")}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  row: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 0,
  },
}));
