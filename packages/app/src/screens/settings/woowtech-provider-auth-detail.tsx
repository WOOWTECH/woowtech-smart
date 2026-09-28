import { Text } from "react-native";
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

const styles = StyleSheet.create((theme) => ({
  detail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
  },
}));
