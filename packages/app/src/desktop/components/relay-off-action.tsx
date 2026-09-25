import { useCallback } from "react";
import { Text, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { daemonPairingOfferQueryKey } from "@/data/daemon-pairing";
import { useDaemonConfig } from "@/hooks/use-daemon-config";

export interface RelayOffActionProps {
  serverId: string;
}

// woowtech smart turns the relay on in new homes, so the pairing screen that shows
// the relay's QR code is also where the user turns it off. The screen then shows
// upstream's "Enable relay?" consent, which turns it back on.
export function RelayOffAction({ serverId }: RelayOffActionProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { patchConfig } = useDaemonConfig(serverId);
  const turnOff = useMutation({
    mutationFn: async () => {
      const config = await patchConfig({ relay: { enabled: false } });
      if (!config) throw new Error(t("workspace.terminal.hostDisconnected"));
      await queryClient.invalidateQueries({ queryKey: daemonPairingOfferQueryKey(serverId) });
    },
  });
  const handlePress = useCallback(() => {
    turnOff.mutate();
  }, [turnOff]);

  return (
    <View style={styles.container}>
      {turnOff.error ? <Alert variant="error" description={turnOff.error.message} /> : null}
      <View style={styles.row}>
        <Text style={styles.hint}>{t("woowtech.pairing.relayOff.hint")}</Text>
        <Button variant="outline" size="sm" loading={turnOff.isPending} onPress={handlePress}>
          {turnOff.isPending
            ? t("woowtech.pairing.relayOff.pending")
            : t("woowtech.pairing.relayOff.action")}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing[4],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  hint: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.5,
  },
}));
