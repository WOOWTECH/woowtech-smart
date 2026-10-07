// woowtech smart (woowtech/README.md section 16): under the test notification in Settings, ask
// whether the banner showed up, and when it did not, say how to turn banners on.
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getDesktopHost } from "@/desktop/host";
import { useNotificationBannerCheck } from "@/hooks/use-notification-banner-check";
import { answerBannerSeen, showBannerHelp } from "@/utils/woowtech-notification-banner-check";

interface NotificationBannerCheckPromptProps {
  onTestAgain: () => void;
}

export function NotificationBannerCheckPrompt({ onTestAgain }: NotificationBannerCheckPromptProps) {
  const { t } = useTranslation();
  const { phase } = useNotificationBannerCheck();
  const canOpenSettings = typeof getDesktopHost()?.notification?.openSystemSettings === "function";

  const openSettings = useCallback(() => {
    void getDesktopHost()?.notification?.openSystemSettings?.();
  }, []);

  if (phase === "asking") {
    return (
      <Alert
        variant="info"
        title={t("woowtech.notificationBannerCheck.askTitle")}
        description={t("woowtech.notificationBannerCheck.askDescription")}
        testID="notification-banner-check-asking"
      >
        <Button size="sm" onPress={answerBannerSeen} testID="notification-banner-check-seen">
          {t("woowtech.notificationBannerCheck.seen")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onPress={showBannerHelp}
          testID="notification-banner-check-not-seen"
        >
          {t("woowtech.notificationBannerCheck.notSeen")}
        </Button>
      </Alert>
    );
  }

  if (phase === "help") {
    return (
      <Alert
        variant="warning"
        title={t("woowtech.notificationBannerCheck.helpTitle")}
        description={t("woowtech.notificationBannerCheck.helpDescription")}
        testID="notification-banner-check-help"
      >
        {canOpenSettings ? (
          <Button size="sm" onPress={openSettings} testID="notification-banner-check-open-settings">
            {t("woowtech.notificationBannerCheck.openSettings")}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          onPress={onTestAgain}
          testID="notification-banner-check-test-again"
        >
          {t("woowtech.notificationBannerCheck.testAgain")}
        </Button>
      </Alert>
    );
  }

  return null;
}
