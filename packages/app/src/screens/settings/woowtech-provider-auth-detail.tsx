import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";

// woowtech smart: the line under a provider's name that explains its login state
// (woowtech/README.md §3). Phones show it too, where the row hides the status label.
export function ProviderAuthDetail({ detail }: { detail: string }) {
  return (
    <Text style={styles.detail} numberOfLines={2}>
      {detail}
    </Text>
  );
}

// woowtech smart: a phone's status dot says the login state to a screen reader
// (woowtech/README.md §3). Without a label it is the plain dot it was.
export function ProviderStatusDot({
  style,
  label,
}: {
  style: StyleProp<ViewStyle>;
  label?: string;
}) {
  if (!label) return <View style={style} />;
  return <View style={style} accessible accessibilityRole="image" accessibilityLabel={label} />;
}

const styles = StyleSheet.create((theme) => ({
  detail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
  },
}));
