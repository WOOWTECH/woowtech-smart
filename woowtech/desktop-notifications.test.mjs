// Merge guards for the small upstream notification seams. Native delivery behavior
// is covered by woowtech-notification-delivery.test.ts with a typed event/timer port.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("desktop IPC waits for native delivery and retains click routing", () => {
  const main = source("packages/desktop/src/features/notifications.ts");
  assert.match(main, /return showNotificationWithDelivery\(\{/);
  assert.match(main, /release: \(\) => \{\s*activeNotifications.delete\(notification\)/);
  assert.match(main, /win.webContents.send\("paseo:event:notification-click", payload\)/);
  assert.doesNotMatch(main, /notification.show\(\);\s*return true/);
  assert.match(main, /notification: probe,\s*closeOnTimeout: true/);
  const regularSend = main.slice(main.indexOf("async function sendWithResult"));
  assert.doesNotMatch(regularSend, /closeOnTimeout/);
  assert.match(main, /return \(await sendWithResult\(event, rawInput\)\) === "shown"/);
  assert.match(main, /ipcMain.handle\("woowtech:notification:sendWithResult", sendWithResult\)/);
  const preload = source("packages/desktop/src/preload.ts");
  assert.match(
    preload,
    /sendNotificationWithResult:[\s\S]*?ipcRenderer.invoke\("woowtech:notification:sendWithResult", payload\)/,
  );
  assert.match(
    preload,
    /sendNotification:[\s\S]*?ipcRenderer.invoke\("paseo:notification:send", payload\)/,
  );
  const osNotifications = source("packages/app/src/utils/os-notifications.ts");
  assert.match(osNotifications, /return await desktopNotificationSender\(payload\)/);
});

test("renderer uses unknown permission, test policy and visible translated result feedback", () => {
  const permission = source("packages/app/src/desktop/permissions/desktop-permissions.ts");
  assert.match(permission, /state: supported \? "unknown" : "unavailable"/);
  const section = source("packages/app/src/desktop/components/desktop-notifications-section.tsx");
  assert.match(section, /canTestNotification\(snapshot\?\.notifications.state\)/);
  assert.match(
    section,
    /disabled=\{!notificationsTestable \|\| isPermissionBusy \|\| isSendingTestNotification\}/,
  );
  for (const key of [
    "testHint",
    "send",
    "successTitle",
    "successDescription",
    "failedTitle",
    "unconfirmedTitle",
  ]) {
    assert.ok(section.includes(`t("woowtech.desktopNotifications.${key}")`), key);
  }
  assert.match(section, /description=\{testNotificationState.message\}/);
  assert.match(
    section,
    /testNotificationState.status === "unconfirmed"[\s\S]*?variant="warning"[\s\S]*?testID="desktop-notifications-test-unconfirmed"/,
  );
  assert.match(section, /testNotificationState.status === "error"[\s\S]*?variant="error"/);
  assert.match(section, /testNotificationState.status === "success"[\s\S]*?variant="success"/);
  const hook = source("packages/app/src/desktop/permissions/use-desktop-permissions.ts");
  assert.match(hook, /await runNotificationTest\(\{/);
  assert.match(hook, /failureMessage: t\("woowtech.desktopNotifications.failed"\)/);
  assert.match(hook, /unconfirmedMessage: t\("woowtech.desktopNotifications.unconfirmed"\)/);
  assert.match(
    hook,
    /sendDesktopTestNotification\(\{\s*bridge: getDesktopHost\(\)\?\.notification,/,
  );
  assert.match(hook, /if \(!isDesktopApp \|\| testNotificationPendingRef.current\)/);
  assert.match(hook, /if \(isMountedRef.current\) setTestNotificationState\(state\)/);
});

test("agent notification caller localizes after existing suppression and deduplication", () => {
  const session = source("packages/app/src/contexts/session-context.tsx");
  const start = session.indexOf("const notifyAgentAttention = useCallback(");
  assert.notEqual(start, -1);
  const callback = session.slice(start, session.indexOf("\n  useEffect(", start));
  assert.match(
    callback,
    /sendOsNotification\(\s*localizeAgentNotification\(\{ notification, reason: params.reason, t \}\)/,
  );
  assert.match(callback, /\[serverId, t\]/);
  assert.match(callback, /if \(params.reason === "error"\) \{\s*return;/);
  assert.match(callback, /if \(!isAwayFromAgent\) \{\s*return;/);
  assert.match(callback, /if \(lastNotified && lastNotified >= timestampMs\) \{\s*return;/);
  assert.match(callback, /attentionNotifiedRef.current.set\(params.agentId, timestampMs\)/);
  assert.match(
    callback,
    /resolveAgentAttentionNotification\(\{\s*notification: params.notification,/,
  );
  assert.ok(
    callback.indexOf("localizeAgentNotification(") > callback.indexOf("if (!notification)"),
  );
  assert.match(session, /return input.notification.data.workspaceId \? input.notification : null/);
  assert.match(session, /return buildAgentAttentionNotificationPayload\(/);
});
