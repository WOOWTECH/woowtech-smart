import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getDesktopPermissionSnapshot,
  requestDesktopPermission,
  shouldShowDesktopPermissionSection,
  type DesktopPermissionKind,
  type DesktopPermissionSnapshot,
} from "@/desktop/permissions/desktop-permissions";
import { sendOsNotification } from "@/utils/os-notifications";
import { runNotificationTest, type TestNotificationState } from "./woowtech-notification-test";

export interface UseDesktopPermissionsReturn {
  isDesktopApp: boolean;
  snapshot: DesktopPermissionSnapshot | null;
  isRefreshing: boolean;
  requestingPermission: DesktopPermissionKind | null;
  testNotificationState: TestNotificationState;
  refreshPermissions: () => Promise<void>;
  requestPermission: (kind: DesktopPermissionKind) => Promise<void>;
  sendTestNotification: () => Promise<void>;
}

export function useDesktopPermissions(): UseDesktopPermissionsReturn {
  const { t } = useTranslation();
  const isDesktopApp = shouldShowDesktopPermissionSection();
  const isMountedRef = useRef(true);
  const testNotificationPendingRef = useRef(false);
  const [snapshot, setSnapshot] = useState<DesktopPermissionSnapshot | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [requestingPermission, setRequestingPermission] = useState<DesktopPermissionKind | null>(
    null,
  );
  const [testNotificationState, setTestNotificationState] = useState<TestNotificationState>({
    status: "idle",
  });

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refreshPermissions = useCallback(async () => {
    if (!isDesktopApp) {
      return;
    }

    setIsRefreshing(true);
    try {
      const nextSnapshot = await getDesktopPermissionSnapshot();
      if (!isMountedRef.current) {
        return;
      }
      setSnapshot(nextSnapshot);
    } catch (error) {
      console.error("[Settings] Failed to load desktop permission status", error);
    } finally {
      if (isMountedRef.current) {
        setIsRefreshing(false);
      }
    }
  }, [isDesktopApp]);

  const requestPermission = useCallback(
    async (kind: DesktopPermissionKind) => {
      if (!isDesktopApp) {
        return;
      }

      setRequestingPermission(kind);
      try {
        const status = await requestDesktopPermission({ kind });
        if (!isMountedRef.current) {
          return;
        }

        setSnapshot((previous) => {
          const base: DesktopPermissionSnapshot = previous ?? {
            checkedAt: Date.now(),
            notifications: {
              state: "unknown",
              detail: t("desktop.permissions.empty.notifications"),
            },
            microphone: {
              state: "unknown",
              detail: t("desktop.permissions.empty.microphone"),
            },
          };

          if (kind === "notifications") {
            return {
              ...base,
              checkedAt: Date.now(),
              notifications: status,
            };
          }

          return {
            ...base,
            checkedAt: Date.now(),
            microphone: status,
          };
        });
      } catch (error) {
        console.error(`[Settings] Failed to request ${kind} permission`, error);
      } finally {
        if (isMountedRef.current) {
          setRequestingPermission(null);
        }
        await refreshPermissions();
      }
    },
    [isDesktopApp, refreshPermissions, t],
  );

  const sendTestNotification = useCallback(async () => {
    if (!isDesktopApp || testNotificationPendingRef.current) {
      return;
    }

    testNotificationPendingRef.current = true;
    try {
      await runNotificationTest({
        send: () =>
          sendOsNotification({
            title: t("desktop.permissions.testNotification.title"),
            body: t("desktop.permissions.testNotification.body"),
          }),
        failureMessage: t("woowtech.desktopNotifications.failed"),
        onState: (state) => {
          if (isMountedRef.current) setTestNotificationState(state);
        },
      });
    } finally {
      testNotificationPendingRef.current = false;
    }
  }, [isDesktopApp, t]);

  useEffect(() => {
    if (!isDesktopApp) {
      return;
    }

    void refreshPermissions();
  }, [isDesktopApp, refreshPermissions]);

  return {
    isDesktopApp,
    snapshot,
    isRefreshing,
    requestingPermission,
    testNotificationState,
    refreshPermissions,
    requestPermission,
    sendTestNotification,
  };
}
