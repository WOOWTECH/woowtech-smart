import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import {
  formatDaemonKeyFingerprint,
  PairingOfferError,
  readPairingOffer,
} from "@/runtime/woowtech-offer-link";

// woowtech smart (fork-owned; woowtech/README.md, 19): the daemon's key fingerprint under the
// pairing QR code, the value the phone's or browser's confirmation sheet asks the user to compare
// (hosts/woowtech-host-confirmation-sheet.tsx).

function fingerprintOf(url: string): string | null {
  try {
    return formatDaemonKeyFingerprint(readPairingOffer(url).daemonPublicKeyB64);
  } catch (error) {
    if (error instanceof PairingOfferError) return null;
    throw error;
  }
}

export interface WoowtechPairingFingerprintProps {
  /** The pairing link the QR code shows. */
  url: string;
}

export function WoowtechPairingFingerprint({ url }: WoowtechPairingFingerprintProps) {
  const { t } = useTranslation();
  const fingerprint = useMemo(() => fingerprintOf(url), [url]);
  if (!fingerprint) return null;
  return (
    <View style={styles.row} testID="pair-device-fingerprint">
      <Text style={styles.label}>{t("woowtech.pairingConfirmation.fingerprintLabel")}</Text>
      <Text style={styles.value} selectable>
        {fingerprint}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  value: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
  },
}));
