// woowtech smart (README section 16): source wiring only. The behaviour is covered by
// packages/server/src/server/woowtech-attention-fallback.test.ts, the in-process daemon test
// woowtech-attention-fallback-daemon.test.ts, packages/protocol/src/woowtech-attention-fallback.test.ts,
// packages/app/src/utils/woowtech-notification-fallback.test.ts and
// packages/desktop/src/features/woowtech-notification-settings.test.ts. Fails when an upstream merge
// drops a seam of "a notice the system did not show goes to the phone" or of the focus rule (c).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

function read(file) {
  return readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
}
function source(file) {
  return ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
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
function methodBody(file, name) {
  const tree = source(file);
  const [found] = findAll(
    tree,
    (node) => ts.isMethodDeclaration(node) && node.name.getText(tree) === name,
  );
  assert.ok(found?.body, `${file} has no method ${name}`);
  return found.body.getText(tree);
}
function unionMembers(file, name) {
  const tree = source(file);
  const [declaration] = findAll(
    tree,
    (node) => ts.isVariableDeclaration(node) && node.name.getText(tree) === name,
  );
  assert.ok(declaration, `${file} has no ${name}`);
  const [array] = findAll(declaration, (node) => ts.isArrayLiteralExpression(node));
  return array.elements.map((element) => element.getText(tree));
}

const protocolMessages = "packages/protocol/src/messages.ts";
const serverFile = "packages/server/src/server/websocket-server.ts";
const sessionFile = "packages/server/src/server/session.ts";

test("the protocol carries the report and its answer, gated by woowtechAttentionFallback", () => {
  assert.ok(
    unionMembers(protocolMessages, "SessionInboundMessageSchema").includes(
      "AttentionDisplayFailureReportRequestSchema",
    ),
  );
  assert.ok(
    unionMembers(protocolMessages, "SessionOutboundMessageSchema").includes(
      "AttentionDisplayFailureReportResponseSchema",
    ),
  );
  assert.match(read(protocolMessages), /woowtechAttentionFallback: z\.boolean\(\)\.optional\(\),/);
});

test("the daemon remembers each notice it hands to a client instead of a push", () => {
  assert.match(read(serverFile), /woowtechAttentionFallback: true,/);
  assert.match(
    read(serverFile),
    /woowtechAttentionFallback: this\.woowtechAttentionFallback,/,
    "createSession must pass the ledger to each Session",
  );
  const agent = methodBody(serverFile, "broadcastAgentAttention");
  assert.match(
    agent,
    /if \(shouldNotify && connection && isPushEligibleAttentionReason\(params\.reason\)\)/,
  );
  assert.match(agent, /this\.woowtechAttentionFallback\.remember\(\{\s*target: \{ kind: "agent"/);
  const terminal = methodBody(serverFile, "broadcastTerminalAttention");
  assert.match(
    terminal,
    /this\.woowtechAttentionFallback\.remember\(\{\s*target: \{ kind: "terminal"/,
  );
  assert.match(terminal, /push: sendPush,/);
  assert.match(terminal, /if \(plan\.shouldPush\) \{\s*sendPush\(\);\s*\}/);
});

test("the session answers a report with the ledger, for the reporting client only", () => {
  const misc = methodBody(sessionFile, "dispatchMiscMessage");
  assert.match(
    misc,
    /case "attention\.notification\.report_display_failure\.request":[\s\S]*?answerAttentionDisplayFailure\(\{\s*fallback: this\.woowtechAttentionFallback,\s*request: msg,\s*reporter: this,/,
  );
  const permissions = read("packages/server/src/server/authorization/operation-permissions.ts");
  assert.match(
    permissions,
    /"attention\.notification\.report_display_failure\.request": "workspace\.read",/,
  );
  assert.match(
    permissions,
    /"attention\.notification\.report_display_failure\.response": "workspace\.read",/,
  );
});

test("the client sends the report only to a daemon that advertises it", () => {
  const client = "packages/client/src/daemon-client.ts";
  assert.match(
    methodBody(client, "supportsAttentionDisplayFallback"),
    /features\?\.woowtechAttentionFallback === true/,
  );
  const report = methodBody(client, "reportAttentionDisplayFailure");
  assert.match(report, /if \(!this\.supportsAttentionDisplayFallback\(\)\)/);
  assert.match(report, /type: "attention\.notification\.report_display_failure\.request"/);
});

test("the app reports agent and terminal notices the system did not show", () => {
  const context = read("packages/app/src/contexts/session-context.tsx");
  const calls = context.match(/handleOsNotificationResult\(\{/g) ?? [];
  assert.equal(calls.length, 2, "both sendOsNotification calls must hand their result over");
  const rejections = context.match(/\.catch\(\(\) => false\)\s*\.then\(\(shown\) =>/g) ?? [];
  assert.equal(rejections.length, 2, "a rejected sendOsNotification counts as not shown");
  assert.match(
    context,
    /target: \{ kind: "agent", agentId: params\.agentId, timestamp: params\.timestamp \}/,
  );
  assert.match(context, /target: \{ kind: "terminal", terminalId \}/);
  assert.match(read("packages/app/src/app/_layout.tsx"), /<NotificationDisplayCalloutSource \/>/);
});

test("the desktop app opens the system's notification settings from fixed URLs only", () => {
  assert.match(
    read("packages/desktop/src/features/notifications.ts"),
    /ipcMain\.handle\("woowtech:notification:openSystemSettings", \(\) =>\s*openSystemNotificationSettings\(\),?\s*\);/,
  );
  assert.match(
    read("packages/desktop/src/preload.ts"),
    /process\.platform === "darwin" \|\| process\.platform === "win32"[\s\S]*?openSystemSettings: \(\) =>\s*ipcRenderer\.invoke\("woowtech:notification:openSystemSettings"\)/,
    "only macOS and Windows have a notification settings page to open",
  );
  assert.match(
    read("packages/app/src/desktop/host.ts"),
    /openSystemSettings\?: \(\) => Promise<boolean>;/,
  );
});

// Decision (c): on web and desktop, appVisible also needs window focus, so a window behind another
// app does not count as the user looking at the agent.
test("web and desktop report appVisible only while the window has focus", () => {
  const hook = read("packages/app/src/hooks/use-client-activity.ts");
  assert.match(hook, /initialAppVisible: getIsAppActivelyVisible\(\),/);
  assert.match(hook, /tracker\.notifyAppVisibility\(getIsAppActivelyVisible\(nextState\)\);/);
  assert.match(hook, /const visible = getIsAppActivelyVisible\(\);/);
  assert.match(hook, /window\.addEventListener\("blur", handleVisibilityChange\);/);
  assert.match(hook, /window\.addEventListener\("focus", handleVisibilityChange\);/);
  assert.doesNotMatch(hook, /const visible = document\.visibilityState === "visible";/);
  assert.match(
    hook,
    /if \(changed\) \{\s*tracker\.sendHeartbeat\(\);\s*\}/,
    "both directions unthrottled",
  );
  assert.match(
    hook,
    /if \(!isNative\) tracker\.notifyAppVisibility\(getIsAppActivelyVisible\(\)\);\s*tracker\.sendHeartbeat\(\);/,
    "periodic heartbeats re-read focus",
  );
});
