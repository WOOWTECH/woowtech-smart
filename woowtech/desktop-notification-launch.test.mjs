// woowtech smart (README section 16, D2a): source wiring only; the behaviour is covered by
// packages/desktop/src/features/woowtech-notification-launch.test.ts. Fails when an upstream merge
// drops the macOS notification id that carries the agent, or the launchInfo read at relaunch.
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
});
