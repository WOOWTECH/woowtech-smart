import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

/** What's new before the first release has any notes: nothing is wrong, so no retry. */
export function ChangelogEmpty() {
  const { t } = useTranslation();

  return (
    <View style={styles.empty} testID="changelog-empty">
      <Text style={styles.title}>{t("woowtech.changelog.empty.title")}</Text>
      <Text style={styles.description}>{t("woowtech.changelog.empty.description")}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  empty: {
    flex: 1,
    minHeight: 160,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
  },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
    textAlign: "center",
  },
  description: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
}));
