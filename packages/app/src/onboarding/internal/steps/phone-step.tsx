import { BRAND_LINKS } from "@getpaseo/protocol/brand-links";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsCard, SettingsDetailRow, SettingsSection } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { PairDeviceModal } from "@/desktop/components/pair-device-modal";
import {
  CONNECTIVITY_DOCS_URL,
  TAILSCALE_DOCS_URL,
} from "@/desktop/components/pair-device-section";
import { openExternalUrl } from "@/utils/open-external-url";

function openUrl(url: string) {
  void openExternalUrl(url).catch(console.error);
}

/** Get the app, then connect it: the relay pairs in a modal, Tailscale is a docs page away. */
export function PhoneStep({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const [isPairing, setIsPairing] = useState(false);
  // The brand website is the download destination until its store listings are configured.
  const openDownloads = useCallback(() => openUrl(BRAND_LINKS.website), []);
  const openTailscaleDocs = useCallback(() => openUrl(TAILSCALE_DOCS_URL), []);
  const openPairing = useCallback(() => setIsPairing(true), []);
  const closePairing = useCallback(() => setIsPairing(false), []);
  const recommendedBadge = useMemo(
    () => (
      <StatusBadge
        size="xs"
        variant="success"
        label={t("onboarding.setup.steps.phone.recommended")}
      />
    ),
    [t],
  );
  const docsLink = useMemo(
    () => ({
      href: CONNECTIVITY_DOCS_URL,
      label: t("onboarding.setup.steps.phone.connectDocs"),
      accessibilityLabel: t("onboarding.setup.steps.phone.openConnectDocs"),
    }),
    [t],
  );

  return (
    <View style={styles.container}>
      <View style={styles.storeLinks}>
        <Button variant="outline" onPress={openDownloads} testID="onboarding-phone-download">
          {BRAND_LINKS.websiteHost}
        </Button>
      </View>
      <SettingsSection title={t("onboarding.setup.steps.phone.connectTitle")} link={docsLink}>
        <SettingsCard>
          <SettingsDetailRow
            label={t("onboarding.setup.steps.phone.relay.title")}
            labelAccessory={recommendedBadge}
            hint={t("onboarding.setup.steps.phone.relay.hint")}
            onPress={openPairing}
            testID="onboarding-phone-relay"
          />
          <SettingsDetailRow
            label={t("onboarding.setup.steps.phone.tailscale.title")}
            hint={t("onboarding.setup.steps.phone.tailscale.hint")}
            summary={t("onboarding.setup.steps.phone.connectDocs")}
            onPress={openTailscaleDocs}
            external
            testID="onboarding-phone-tailscale"
          />
        </SettingsCard>
      </SettingsSection>
      <PairDeviceModal
        serverId={serverId}
        visible={isPairing}
        onClose={closePairing}
        testID="onboarding-pair-device-card"
      />
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
