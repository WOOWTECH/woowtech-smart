// woowtech smart (README section 16, D2a): source wiring only; the behaviour is covered by
// packages/desktop/src/features/woowtech-notification-launch.test.ts. Fails when an upstream merge
// drops the macOS notification id, the launchInfo read, or its primary-window route at relaunch.
// Relaunch uses the canonical agent URL; live renderer clicks use notification-open/electron.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function read(file) {
  return readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
}

test("a macOS agent notification carries the agent in its id", () => {
  const notifications = read("packages/desktop/src/features/notifications.ts");
  assert.match(notifications, /const agent = agentTargetForNotificationData\(data\);/);
  assert.match(
    notifications,
    /agent && process\.platform === "darwin" \? agentNotificationId\(agent, randomUUID\(\)\) : null;/,
  );
  assert.match(notifications, /\.\.\.\(macId \? \{ id: macId \} : \{\}\),/);
});

test("a relaunch from Notification Center opens the agent in the id", () => {
  const main = read("packages/desktop/src/main.ts");
  const ready = main.indexOf('app.once("ready", (_event, launchInfo) => {');
  const whenReady = main.indexOf("await app.whenReady();");
  assert.ok(ready !== -1, "main.ts must read launchInfo in a ready listener");
  assert.ok(ready < whenReady, "the ready listener must be registered before bootstrap awaits it");
  assert.match(
    main.slice(ready, ready + 400),
    /const target = agentTargetFromLaunchInfo\(launchInfo\);[\s\S]*pendingAgentNavigation = target;/,
  );
  assert.match(
    main.slice(ready, ready + 400),
    /if \(!target \|\| pendingAgentNavigation\)\s*\{\s*return;/,
    "an unrelated launch or an existing argv target must not be replaced",
  );
});

test("a notification relaunch seeds the primary window with the canonical agent route", () => {
  const main = read("packages/desktop/src/main.ts");
  assert.match(
    main,
    /const initialAgentNavigation = pendingAgentNavigation;\s*pendingAgentNavigation = null;\s*await desktopWindowOwner\.openPrimary\(\{\s*initialRoute: initialAgentNavigation \? buildAgentDeepLinkRoute\(initialAgentNavigation\) : null,/,
    "the captured notification must reach the new window, rather than remembered workspace restore",
  );
});
