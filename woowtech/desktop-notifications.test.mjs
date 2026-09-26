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
  assert.match(main, /notification: probe/);
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
  for (const key of ["testHint", "send", "successTitle", "successDescription"]) {
    assert.ok(section.includes(`t("woowtech.desktopNotifications.${key}")`), key);
  }
  assert.match(section, /description=\{testNotificationState.message\}/);
  const hook = source("packages/app/src/desktop/permissions/use-desktop-permissions.ts");
  assert.match(hook, /await runNotificationTest\(\{/);
  assert.match(hook, /failureMessage: t\("woowtech.desktopNotifications.failed"\)/);
  assert.match(hook, /if \(!isDesktopApp \|\| testNotificationPendingRef.current\)/);
  assert.match(hook, /if \(isMountedRef.current\) setTestNotificationState\(state\)/);
});
