// woowtech smart (woowtech/README.md section 16): once per launch, when the system did not show an
// agent or terminal notice, say so in the sidebar and offer the system's notification settings.
// The notice itself already went to the phone (utils/woowtech-notification-fallback.ts).
import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { SidebarCalloutDescriptionText } from "@/components/sidebar-callout";
import { getIsElectron } from "@/constants/platform";
import { useSidebarCallouts } from "@/contexts/sidebar-callout-context";
import { getDesktopHost } from "@/desktop/host";
import { useStableEvent } from "@/hooks/use-stable-event";
import {
  getNotificationDisplayFailedThisLaunch,
  subscribeToNotificationDisplayFailure,
} from "@/utils/woowtech-notification-fallback";

let dismissedThisLaunch = false;

export function NotificationDisplayCalloutSource() {
  const { t } = useTranslation();
  const callouts = useSidebarCallouts();
  const displayFailed = useSyncExternalStore(
    subscribeToNotificationDisplayFailure,
    getNotificationDisplayFailedThisLaunch,
    getNotificationDisplayFailedThisLaunch,
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
    if (!isElectron || !displayFailed || dismissed) {
      return;
    }
    const canOpenSettings =
      typeof getDesktopHost()?.notification?.openSystemSettings === "function";
    return callouts.show({
      id: "woowtech-notification-display-failed",
      priority: 200,
      title: t("woowtech.notificationDisplay.title"),
      description: (
        <SidebarCalloutDescriptionText>
          {t("woowtech.notificationDisplay.description")}
        </SidebarCalloutDescriptionText>
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
  }, [callouts, dismissed, displayFailed, isElectron, openSettings, rememberDismissal, t]);

  return null;
}
