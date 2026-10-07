// woowtech smart (woowtech/README.md section 16): macOS hides a new app's notifications until the
// person answers the permission prompt it shows on first launch, and still tells the app every
// notification was shown. So the desktop app asks in the sidebar, once per computer: send a test
// notification, then "Did you see the banner?". Settings > Notifications asks the same question
// (notification-banner-check-prompt.tsx) and shares the answer.
import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { SidebarCalloutAction } from "@/components/sidebar-callout";
import { SidebarCalloutDescriptionText } from "@/components/sidebar-callout";
import { getIsElectron } from "@/constants/platform";
import { useSidebarCallouts } from "@/contexts/sidebar-callout-context";
import { getDesktopHost } from "@/desktop/host";
import { sendDesktopTestNotification } from "@/desktop/permissions/woowtech-notification-test";
import { useNotificationBannerCheck } from "@/hooks/use-notification-banner-check";
import { useStableEvent } from "@/hooks/use-stable-event";
import {
  answerBannerSeen,
  loadBannerCheck,
  sendBannerCheckNotification,
  showBannerHelp,
  type BannerCheckPhase,
} from "@/utils/woowtech-notification-banner-check";

const CALLOUT_ID = "woowtech-notification-banner-check";
// Ties go to the callout registered first, and this one registers again each time its content
// changes: while the person is answering it, it stays in front of the other sidebar callouts
// (worktree setup is 100, a notice the system did not show is 200, Rosetta is 300).
const IDLE_PRIORITY = 100;
const ANSWERING_PRIORITY = 250;

interface BannerCheckCalloutContent {
  title: string;
  description: ReactNode;
  actions: SidebarCalloutAction[];
}

interface BannerCheckCalloutHandlers {
  sendTest: () => void;
  openSettings: (() => void) | null;
}

function bannerCheckCalloutContent(
  phase: BannerCheckPhase,
  t: (key: string) => string,
  handlers: BannerCheckCalloutHandlers,
): BannerCheckCalloutContent {
  if (phase === "asking") {
    return {
      title: t("woowtech.notificationBannerCheck.askTitle"),
      description: t("woowtech.notificationBannerCheck.askDescription"),
      actions: [
        {
          label: t("woowtech.notificationBannerCheck.seen"),
          onPress: answerBannerSeen,
          variant: "primary",
        },
        { label: t("woowtech.notificationBannerCheck.notSeen"), onPress: showBannerHelp },
      ],
    };
  }
  if (phase === "help") {
    const openSettings: SidebarCalloutAction[] = handlers.openSettings
      ? [
          {
            label: t("woowtech.notificationBannerCheck.openSettings"),
            onPress: handlers.openSettings,
            variant: "primary",
          },
        ]
      : [];
    return {
      title: t("woowtech.notificationBannerCheck.helpTitle"),
      description: (
        <SidebarCalloutDescriptionText>
          {t("woowtech.notificationBannerCheck.helpDescription")}
        </SidebarCalloutDescriptionText>
      ),
      actions: [
        ...openSettings,
        { label: t("woowtech.notificationBannerCheck.testAgain"), onPress: handlers.sendTest },
      ],
    };
  }
  return {
    title: t("woowtech.notificationBannerCheck.idleTitle"),
    description: t("woowtech.notificationBannerCheck.idleDescription"),
    actions: [
      {
        label: t("woowtech.notificationBannerCheck.send"),
        onPress: handlers.sendTest,
        variant: "primary",
      },
    ],
  };
}

export function NotificationBannerCheckCalloutSource() {
  const { t } = useTranslation();
  const callouts = useSidebarCallouts();
  const { loaded, confirmed, phase } = useNotificationBannerCheck();
  const isElectron = getIsElectron();

  const sendTest = useStableEvent(() => {
    void sendBannerCheckNotification(() =>
      sendDesktopTestNotification({
        bridge: getDesktopHost()?.notification,
        payload: {
          title: t("desktop.permissions.testNotification.title"),
          body: t("desktop.permissions.testNotification.body"),
        },
      }),
    );
  });
  const openSettings = useStableEvent(() => {
    void getDesktopHost()?.notification?.openSystemSettings?.();
  });

  useEffect(() => {
    if (isElectron) {
      void loadBannerCheck();
    }
  }, [isElectron]);

  useEffect(() => {
    if (!isElectron || !loaded || confirmed) {
      return;
    }
    const canOpenSettings =
      typeof getDesktopHost()?.notification?.openSystemSettings === "function";
    const content = bannerCheckCalloutContent(phase, t, {
      sendTest,
      openSettings: canOpenSettings ? openSettings : null,
    });
    return callouts.show({
      id: CALLOUT_ID,
      // Closing it is an answer too: it stays closed on this computer.
      dismissalKey: CALLOUT_ID,
      priority: phase === "idle" ? IDLE_PRIORITY : ANSWERING_PRIORITY,
      ...content,
      dismissible: true,
      testID: "notification-banner-check-callout",
    });
  }, [callouts, confirmed, isElectron, loaded, openSettings, phase, sendTest, t]);

  return null;
}
