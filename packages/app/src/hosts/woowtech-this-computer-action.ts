import { useCallback, useMemo, useRef, useState } from "react";
import { DEFAULT_DAEMON_PORT } from "@getpaseo/protocol/brand-daemon";
import { useTranslation } from "react-i18next";
import { Monitor } from "lucide-react-native";
import { useToast } from "@/contexts/toast-context";
import { useHostMutations } from "@/runtime/host-runtime";
import { isHostConfirmationDeclined } from "@/runtime/woowtech-host-confirmations";
import { shouldOfferThisComputerAction } from "@/runtime/woowtech-localhost-probe-policy";
import type { HostProfile } from "@/types/host-connection";

// woowtech smart (fork-owned; woowtech/README.md, 19): the welcome screen's "Connect to this
// computer" in desktop browsers on the public web app, which no longer probes localhost at boot
// (runtime/woowtech-localhost-probe-policy.ts, owner decision O2). The browser's local network
// prompt then comes from the user's own press.

/** host-runtime.ts's LOCALHOST_FALLBACK_ENDPOINT, the boot probe's address. A guard keeps them equal. */
const THIS_COMPUTER_ENDPOINT = `localhost:${DEFAULT_DAEMON_PORT}`;
// Long enough to read both sentences; the toast holds while the pointer is over it.
const FAILURE_TOAST_MS = 10_000;

export interface ThisComputerWelcomeAction {
  key: "this-computer";
  label: string;
  testID: "welcome-this-computer";
  primary: false;
  icon: typeof Monitor;
  onPress: () => void;
}

export interface SavedThisComputer {
  profile: HostProfile;
  serverId: string;
}

/** The welcome action, or null where the policy does not offer it. */
export function useThisComputerWelcomeAction(
  onSaved: (saved: SavedThisComputer) => void,
): ThisComputerWelcomeAction | null {
  const { t } = useTranslation();
  const toast = useToast();
  const { probeAndUpsertDirectConnection } = useHostMutations();
  const [offered] = useState(shouldOfferThisComputerAction);
  const [connecting, setConnecting] = useState(false);
  // Two presses before the next render would both see connecting === false.
  const connectingRef = useRef(false);

  const connect = useCallback(async () => {
    if (connectingRef.current) return;
    connectingRef.current = true;
    setConnecting(true);
    try {
      const { profile, serverId } = await probeAndUpsertDirectConnection({
        endpoint: THIS_COMPUTER_ENDPOINT,
      });
      onSaved({ profile, serverId });
    } catch (error) {
      if (isHostConfirmationDeclined(error)) return;
      // React Native Web's Alert.alert does nothing, and this button exists only in browsers.
      toast.show(
        `${t("woowtech.pairingConfirmation.thisComputerFailedTitle")}\n${t("woowtech.pairingConfirmation.thisComputerFailed")}`,
        { variant: "error", durationMs: FAILURE_TOAST_MS, testID: "welcome-this-computer-failed" },
      );
    } finally {
      connectingRef.current = false;
      setConnecting(false);
    }
  }, [onSaved, probeAndUpsertDirectConnection, t, toast]);

  const onPress = useCallback(() => {
    void connect();
  }, [connect]);

  const label = connecting
    ? t("common.connectionStatus.connecting")
    : t("woowtech.pairingConfirmation.thisComputer");

  return useMemo<ThisComputerWelcomeAction | null>(() => {
    if (!offered) return null;
    return {
      key: "this-computer",
      label,
      testID: "welcome-this-computer",
      primary: false,
      icon: Monitor,
      onPress,
    };
  }, [label, offered, onPress]);
}
