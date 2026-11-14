// woowtech smart (README section 16): source wiring only; the behaviour is covered by
// packages/server/src/server/woowtech-attention-presence.test.ts, the woowtech cases in
// websocket-server.notifications.test.ts and websocket-server.terminal-notifications.test.ts, and
// woowtech-attention-without-phone-daemon.test.ts. Fails when an upstream merge puts the daemon's
// presence rules back to upstream.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const serverFile = "packages/server/src/server/websocket-server.ts";

function source(file) {
  return ts.createSourceFile(
    file,
    readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}
function findAll(node, predicate) {
  const found = [];
  function visit(child) {
    if (predicate(child)) found.push(child);
    ts.forEachChild(child, visit);
  }
  visit(node);
  return found;
}
function method(tree, name) {
  const [found] = findAll(
    tree,
    (node) => ts.isMethodDeclaration(node) && node.name.getText(tree) === name,
  );
  assert.ok(found, `${serverFile} has no method ${name}`);
  return found;
}

test("the daemon maps client activity through woowtechClientPresenceState", () => {
  const tree = source(serverFile);
  const body = method(tree, "getClientActivityState").body.getText(tree);
  assert.match(body, /return woowtechClientPresenceState\(activity\);/);
  assert.doesNotMatch(body, /lastActivityAtMs: activity\.lastActivityAt\.getTime\(\)/);
});

// Nothing notifies while the daemon stops: the flag is read before the first await, and the daemon raises it before it
// closes agents.
test("attention raised while the daemon stops notifies nobody", () => {
  const tree = source(serverFile);
  for (const name of ["broadcastAgentAttention", "broadcastTerminalAttention"]) {
    const statements = method(tree, name).body.statements;
    assert.match(
      statements[0].getText(tree),
      /^const woowtechStopping = this\.connectionLifecycle === "stopping";$/,
      `${name} must read the stopping flag first`,
    );
    assert.match(
      method(tree, name).body.getText(tree),
      /const plan = woowtechNotificationPlanWhileStopping\(\s*this\.woowtechPlanWithoutPhone\(\s*computeNotificationPlan\(/,
      `${name} must pass its plan through woowtechNotificationPlanWhileStopping last`,
    );
  }

  const bootstrap = readFileSync(
    new URL("../packages/server/src/server/bootstrap.ts", import.meta.url),
    "utf8",
  );
  const prepare = bootstrap.indexOf("wsServer?.prepareForShutdown();");
  const close = bootstrap.indexOf("await closeAllAgents(logger, agentManager);");
  assert.ok(prepare !== -1 && close !== -1, "bootstrap stop() no longer has the expected steps");
  assert.ok(prepare < close, "bootstrap must stop the WebSocket server before closing agents");
});

// With nobody present and no phone to push to, the computer used last shows the notice (owner
// 2026-11-14): both broadcasts hand upstream's plan, with the clients it was computed from, to
// the rule, and the rule asks the push token store.
test("with no phone to push to, the computer used last shows the notice", () => {
  const tree = source(serverFile);
  for (const name of ["broadcastAgentAttention", "broadcastTerminalAttention"]) {
    const body = method(tree, name).body.getText(tree);
    assert.match(
      body,
      /const allStates = notificationEntries\.map\(\(e\) => e\.state\);/,
      `${name} must compute its plan from notificationEntries, in that order`,
    );
    assert.match(
      body,
      /this\.woowtechPlanWithoutPhone\(\s*computeNotificationPlan\(\{[\s\S]*?\}\),\s*notificationEntries,\s*nowMs,\s*\)/,
      `${name} must pass its plan through woowtechPlanWithoutPhone`,
    );
  }
  const helper = method(tree, "woowtechPlanWithoutPhone").body.getText(tree);
  assert.match(helper, /return woowtechNotificationPlanWithoutPhone\(\{/);
  assert.match(
    helper,
    /deviceType: this\.sessions\.get\(ws\)\?\.session\.getClientActivity\(ws\)\?\.deviceType \?\? null,/,
  );
  assert.match(helper, /hasPushTargets: \(\) => this\.pushNotifications\.hasActiveTokens\(\),/);
});
