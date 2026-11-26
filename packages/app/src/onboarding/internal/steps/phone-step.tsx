import { BRAND_LINKS } from "@getpaseo/protocol/brand-links";
import { useCallback } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { WaysToConnect } from "@/devices";
import { openExternalUrl } from "@/utils/open-external-url";

function openUrl(url: string) {
  void openExternalUrl(url).catch(console.error);
}

/** Get the app, then connect it the same ways the host's Devices settings offer. */
export function PhoneStep({ serverId }: { serverId: string }) {
  const openDownloads = useCallback(() => openUrl(BRAND_LINKS.website), []);

  return (
    <View style={styles.container}>
      <View style={styles.storeLinks}>
        <Button variant="outline" onPress={openDownloads} testID="onboarding-phone-download">
          {BRAND_LINKS.websiteHost}
        </Button>
      </View>
      <WaysToConnect serverId={serverId} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[6],
  },
  storeLinks: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
}));
