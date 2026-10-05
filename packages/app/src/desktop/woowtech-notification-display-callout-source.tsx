// woowtech smart (woowtech/README.md section 16): once per launch, when the system did not show an
// agent or terminal notice, say so in the sidebar, say whether the phone got it instead
// (utils/woowtech-notification-fallback.ts), and offer the system's notification settings.
import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { SidebarCalloutDescriptionText } from "@/components/sidebar-callout";
import { getIsElectron } from "@/constants/platform";
import { useSidebarCallouts } from "@/contexts/sidebar-callout-context";
import { getDesktopHost } from "@/desktop/host";
import { useStableEvent } from "@/hooks/use-stable-event";
import {
  getNotificationDisplayFailure,
  subscribeToNotificationDisplayFailure,
  type NotificationDisplayFailure,
} from "@/utils/woowtech-notification-fallback";

const PHONE_NOTE_KEYS: Readonly<Record<NotificationDisplayFailure, string | null>> = {
  none: null,
  sent_to_phone: "woowtech.notificationDisplay.sentToPhone",
  not_sent: null,
  host_too_old: "woowtech.notificationDisplay.hostTooOld",
};

let dismissedThisLaunch = false;

export function NotificationDisplayCalloutSource() {
  const { t } = useTranslation();
  const callouts = useSidebarCallouts();
  const displayFailure = useSyncExternalStore(
    subscribeToNotificationDisplayFailure,
    getNotificationDisplayFailure,
    getNotificationDisplayFailure,
  );
  const [dismissed, setDismissed] = useState(dismissedThisLaunch);
  const isElectron = getIsElectron();

  const openSettings = useStableEvent(() => {
    void getDesktopHost()?.notification?.openSystemSettings?.();
  });
  const rememberDismissal = useStableEvent(() => {
    dismissedThisLaunch = true;
    setDismissed(true);
  });

  useEffect(() => {
    if (!isElectron || displayFailure === "none" || dismissed) {
      return;
    }
    const phoneNoteKey = PHONE_NOTE_KEYS[displayFailure];
    const canOpenSettings =
      typeof getDesktopHost()?.notification?.openSystemSettings === "function";
    return callouts.show({
      id: "woowtech-notification-display-failed",
      priority: 200,
      title: t("woowtech.notificationDisplay.title"),
      description: (
        <>
          <SidebarCalloutDescriptionText>
            {t("woowtech.notificationDisplay.description")}
          </SidebarCalloutDescriptionText>
          {phoneNoteKey ? (
            <SidebarCalloutDescriptionText>{t(phoneNoteKey)}</SidebarCalloutDescriptionText>
          ) : null}
        </>
      ),
      dismissible: true,
      onDismiss: rememberDismissal,
      actions: canOpenSettings
        ? [
            {
              label: t("woowtech.notificationDisplay.openSettings"),
              onPress: openSettings,
              variant: "primary",
            },
          ]
        : [],
      testID: "notification-display-callout",
    });
  }, [callouts, dismissed, displayFailure, isElectron, openSettings, rememberDismissal, t]);

  return null;
}
