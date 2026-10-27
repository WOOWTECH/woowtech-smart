import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type Ref } from "react";
import {
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { BRAND_RELAY } from "@getpaseo/protocol/brand-relay";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Alert } from "@/components/ui/alert";
import { createControlGeometry } from "@/components/ui/control-geometry";
import { isWeb } from "@/constants/platform";
import {
  hostConfirmations,
  type ChangedConnectionRequest,
  type DirectConnectionToSavedHostRequest,
  type HostConfirmationRequest,
  type HostConfirmations,
  type KeyChangedRequest,
  type NewDirectHostRequest,
  type NewHostRequest,
} from "@/runtime/woowtech-host-confirmations";
import { isBrowserRuntime } from "@/runtime/woowtech-localhost-probe-policy";
import { displayText } from "@/runtime/woowtech-offer-link";
import { settingsStyles } from "@/styles/settings";
import { useConnectArming } from "./woowtech-confirm-arming";

// woowtech smart (fork-owned; woowtech/README.md, 19): the sheet for the question the app is
// waiting on (runtime/woowtech-host-confirmations.ts). Layout and test ids follow upstream's
// HostConfirmationSheet (364e6456e). The fork adds the saved host's name and relays, the blocked
// key change, the two direct-connection questions, the relay and browser warnings, and the
// arming of Connect (woowtech-confirm-arming.ts). Every value from a link, a daemon or saved data
// goes through displayText.

const COPY = "woowtech.pairingConfirmation";

interface DismissButton {
  labelKey: string;
  testID: string;
}

const CANCEL: DismissButton = {
  labelKey: "common.actions.cancel",
  testID: "host-confirmation-cancel",
};
const CLOSE: DismissButton = {
  labelKey: "common.actions.close",
  testID: "host-confirmation-close",
};

interface DetailRowModel {
  label: string;
  value: string;
  testID: string;
}

interface SheetModel {
  title: string;
  description: string;
  descriptionTestID: string;
  /** A line under the description. */
  note: string | null;
  rows: DetailRowModel[];
  /** The warning for a relay that is not woowtech smart's. */
  otherRelay: string | null;
  /** false: the question can only be closed. */
  canConnect: boolean;
}

function serverIdRow(t: TFunction, serverId: string): DetailRowModel {
  return {
    label: t(`${COPY}.hostLabel`),
    value: displayText(serverId),
    testID: "host-confirmation-server-id",
  };
}

function savedLabelRow(t: TFunction, savedLabel: string): DetailRowModel {
  return {
    label: t(`${COPY}.hostLabel`),
    value: displayText(savedLabel),
    testID: "host-confirmation-saved-label",
  };
}

function fingerprintRow(t: TFunction, keyFingerprint: string): DetailRowModel {
  return {
    label: t(`${COPY}.fingerprintLabel`),
    value: displayText(keyFingerprint),
    testID: "host-confirmation-fingerprint",
  };
}

function relayRow(t: TFunction, relayEndpoint: string): DetailRowModel {
  return {
    label: t(`${COPY}.relayLabel`),
    value: displayText(relayEndpoint),
    testID: "host-confirmation-relay",
  };
}

function savedRelayRows(t: TFunction, savedRelayEndpoints: string[]): DetailRowModel[] {
  if (savedRelayEndpoints.length === 0) return [];
  return [
    {
      label: t(`${COPY}.savedRelayLabel`),
      value: displayText(savedRelayEndpoints.join(", ")),
      testID: "host-confirmation-saved-relay",
    },
  ];
}

function endpointRow(t: TFunction, endpoint: string): DetailRowModel {
  return {
    label: t(`${COPY}.endpointLabel`),
    value: displayText(endpoint),
    testID: "host-confirmation-endpoint",
  };
}

function otherRelayWarning(t: TFunction, usesProductRelay: boolean): string | null {
  return usesProductRelay ? null : t(`${COPY}.otherRelay`, { relay: BRAND_RELAY.endpoint });
}

function newHostModel(t: TFunction, request: NewHostRequest): SheetModel {
  return {
    title: t(`${COPY}.title`),
    description: t(`${COPY}.description`),
    descriptionTestID: "host-confirmation-description",
    note: t(`${COPY}.compareFingerprint`),
    rows: [
      serverIdRow(t, request.serverId),
      fingerprintRow(t, request.keyFingerprint),
      relayRow(t, request.relayEndpoint),
    ],
    otherRelay: otherRelayWarning(t, request.usesProductRelay),
    canConnect: true,
  };
}

function changedConnectionModel(t: TFunction, request: ChangedConnectionRequest): SheetModel {
  return {
    title: t(`${COPY}.title`),
    description: t(`${COPY}.descriptionChanged`),
    descriptionTestID: "host-confirmation-description",
    note: null,
    rows: [
      savedLabelRow(t, request.savedLabel),
      serverIdRow(t, request.serverId),
      fingerprintRow(t, request.keyFingerprint),
      ...savedRelayRows(t, request.savedRelayEndpoints),
      relayRow(t, request.relayEndpoint),
    ],
    otherRelay: otherRelayWarning(t, request.usesProductRelay),
    canConnect: true,
  };
}

function keyChangedModel(t: TFunction, request: KeyChangedRequest): SheetModel {
  return {
    title: t(`${COPY}.keyChangedTitle`),
    description: t(`${COPY}.keyChangedDescription`, { label: displayText(request.savedLabel) }),
    descriptionTestID: "host-confirmation-key-changed",
    note: null,
    rows: [],
    otherRelay: null,
    canConnect: false,
  };
}

function savedHostModel(t: TFunction, request: DirectConnectionToSavedHostRequest): SheetModel {
  const label = displayText(request.savedLabel);
  return {
    title: t(`${COPY}.savedHostTitle`, { label }),
    description: t(`${COPY}.savedHostDescription`, {
      label,
      endpoint: displayText(request.endpoint),
    }),
    descriptionTestID: "host-confirmation-description",
    note: null,
    rows: [savedLabelRow(t, request.savedLabel), endpointRow(t, request.endpoint)],
    otherRelay: null,
    canConnect: true,
  };
}

function newDirectHostModel(t: TFunction, request: NewDirectHostRequest): SheetModel {
  return {
    title: t(`${COPY}.title`),
    description: t(`${COPY}.description`),
    descriptionTestID: "host-confirmation-description",
    note: null,
    rows: [serverIdRow(t, request.serverId), endpointRow(t, request.endpoint)],
    otherRelay: null,
    canConnect: true,
  };
}

function sheetModel(t: TFunction, request: HostConfirmationRequest): SheetModel {
  switch (request.kind) {
    case "newHost":
      return newHostModel(t, request);
    case "changedConnection":
      return changedConnectionModel(t, request);
    case "keyChanged":
      return keyChangedModel(t, request);
    case "directConnectionToSavedHost":
      return savedHostModel(t, request);
    case "newDirectHost":
      return newDirectHostModel(t, request);
  }
}

export interface WoowtechHostConfirmationSheetProps {
  /** The app's store unless a test passes its own. */
  confirmations?: HostConfirmations;
}

/** Shows the host confirmation the app is waiting on. Mount once at the app root. */
export function WoowtechHostConfirmationSheet({
  confirmations = hostConfirmations,
}: WoowtechHostConfirmationSheetProps) {
  const subscribe = useCallback(
    (listener: () => void) => confirmations.subscribe(listener),
    [confirmations],
  );
  const getPending = useCallback(() => confirmations.getPending(), [confirmations]);
  const request = useSyncExternalStore(subscribe, getPending, getPending);
  if (!request) return null;
  // One sheet per question: a new question arms and takes the focus from the start.
  return <ConfirmationSheet key={request.id} request={request} confirmations={confirmations} />;
}

interface ConfirmationSheetProps {
  request: HostConfirmationRequest;
  confirmations: HostConfirmations;
}

function ConfirmationSheet({ request, confirmations }: ConfirmationSheetProps) {
  const { t } = useTranslation();
  const { armed, onPointerMove, onPointerDown, onConnectPressIn, acceptPress } = useConnectArming(
    request.id,
  );
  const dismissRef = useRef<View>(null);
  const model = useMemo(() => sheetModel(t, request), [t, request]);
  const header = useMemo<SheetHeader>(() => ({ title: model.title }), [model.title]);
  const inBrowser = isBrowserRuntime();

  const decline = useCallback(
    () => confirmations.answer(request.id, false),
    [confirmations, request.id],
  );
  const connect = useCallback(() => {
    if (acceptPress()) confirmations.answer(request.id, true);
  }, [acceptPress, confirmations, request.id]);

  useEffect(() => {
    // A key held down or pressed as the sheet appears lands on Cancel, not Connect.
    if (isWeb) dismissRef.current?.focus();
  }, []);

  const dismiss = model.canConnect ? CANCEL : CLOSE;

  return (
    <AdaptiveModalSheet header={header} visible onClose={decline} testID="host-confirmation">
      <View style={styles.content} onPointerMove={onPointerMove} onPointerDown={onPointerDown}>
        <Text style={styles.description} testID={model.descriptionTestID}>
          {model.description}
        </Text>
        {model.note ? <Text style={styles.note}>{model.note}</Text> : null}
        {model.rows.length > 0 ? (
          <View style={settingsStyles.card}>
            {model.rows.map((row, index) => (
              <DetailRow key={row.testID} row={row} showBorder={index > 0} />
            ))}
          </View>
        ) : null}
        {model.otherRelay ? (
          <Alert
            variant="warning"
            description={model.otherRelay}
            testID="host-confirmation-other-relay"
          />
        ) : null}
        {inBrowser && model.canConnect ? (
          <Alert
            variant="warning"
            description={t(`${COPY}.webWarning`)}
            testID="host-confirmation-web-warning"
          />
        ) : null}
        <View style={styles.actions}>
          <SheetButton
            buttonRef={dismissRef}
            label={t(dismiss.labelKey)}
            testID={dismiss.testID}
            onPress={decline}
          />
          {model.canConnect ? (
            <SheetButton
              primary
              disabled={!armed}
              label={t(`${COPY}.connect`)}
              testID="host-confirmation-connect"
              onPressIn={onConnectPressIn}
              onPress={connect}
            />
          ) : null}
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

interface DetailRowProps {
  row: DetailRowModel;
  showBorder: boolean;
}

function DetailRow({ row, showBorder }: DetailRowProps) {
  return (
    <View style={[settingsStyles.row, showBorder && settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{row.label}</Text>
        <Text
          style={[settingsStyles.rowHint, styles.value]}
          numberOfLines={1}
          selectable
          testID={row.testID}
        >
          {row.value}
        </Text>
      </View>
    </View>
  );
}

interface SheetButtonProps {
  label: string;
  testID: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
  onPressIn?: (event: GestureResponderEvent) => void;
  /** A Pressable rather than the shared Button, which takes no ref: Cancel takes the focus. */
  buttonRef?: Ref<View>;
}

function SheetButton({
  label,
  testID,
  onPress,
  primary = false,
  disabled = false,
  onPressIn,
  buttonRef,
}: SheetButtonProps) {
  const accessibilityState = useMemo(() => ({ disabled }), [disabled]);
  const pressableStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.button,
      primary ? styles.buttonPrimary : styles.buttonSecondary,
      pressed ? styles.buttonPressed : null,
      disabled ? styles.buttonDisabled : null,
    ],
    [disabled, primary],
  );
  return (
    <Pressable
      ref={buttonRef}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={accessibilityState}
      disabled={disabled}
      onPressIn={onPressIn}
      onPress={onPress}
      style={pressableStyle}
    >
      <Text style={primary ? styles.buttonTextPrimary : styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

// The buttons look like the shared Button's secondary and default variants at size sm.
const styles = StyleSheet.create((theme) => {
  const geometry = createControlGeometry(theme);
  return {
    content: {
      gap: theme.spacing[4],
    },
    description: {
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.base,
    },
    note: {
      color: theme.colors.foregroundMuted,
      fontSize: theme.fontSize.sm,
    },
    value: {
      fontFamily: theme.fontFamily.mono,
    },
    actions: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing[2],
    },
    button: {
      ...geometry.buttonSm,
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
    },
    buttonSecondary: {
      backgroundColor: theme.colors.surface3,
      borderColor: theme.colors.surface3,
    },
    buttonPrimary: {
      backgroundColor: theme.colors.accent,
      borderColor: theme.colors.accent,
    },
    buttonPressed: {
      opacity: 0.85,
    },
    buttonDisabled: {
      opacity: theme.opacity[50],
    },
    buttonText: {
      ...geometry.buttonText,
      color: theme.colors.foreground,
    },
    buttonTextPrimary: {
      ...geometry.buttonText,
      color: theme.colors.accentForeground,
    },
  };
});
