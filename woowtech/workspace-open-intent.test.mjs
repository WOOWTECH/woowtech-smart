// Source wiring only. The navigation behavior, including the Android S2 -> S3 sequence, is covered
// by packages/app/src/navigation/woowtech-workspace-open-intent.test.ts, the RC-I-21c cold start by
// packages/app/src/navigation/woowtech-cold-start-tap.test.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const routeFile = "packages/app/src/app/h/[serverId]/workspace/[workspaceId]/index.tsx";

function source(file) {
  return ts.createSourceFile(
    file,
    readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
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
function variable(scope, name, tree) {
  const matches = findAll(
    scope,
    (node) => ts.isVariableDeclaration(node) && node.name.getText(tree) === name,
  );
  assert.equal(matches.length, 1, `expected one declaration of ${name}`);
  return matches[0];
}

function call(scope, name, tree) {
  const matches = findAll(
    scope,
    (node) => ts.isCallExpression(node) && node.expression.getText(tree) === name,
  );
  assert.equal(matches.length, 1, `expected one call to ${name}`);
  return matches[0];
}
function fn(tree, name) {
  const matches = findAll(
    tree,
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
  );
  assert.equal(matches.length, 1, `expected one function ${name}`);
  return matches[0];
}
function property(object, name, tree) {
  assert.ok(ts.isObjectLiteralExpression(object));
  const matches = object.properties.filter((node) => node.name?.getText(tree) === name);
  assert.equal(matches.length, 1, `expected one property ${name}`);
  const node = matches[0];
  return ts.isShorthandPropertyAssignment(node) ? node.name : node.initializer;
}

test("legacy open links read only the matched workspace's local params", () => {
  const tree = source(routeFile);
  // A retained host route can keep an old ?open. Global params would replay it into another
  // workspace (Android S3); the current compatibility boundary reads the matched leaf instead.
  assert.equal(
    findAll(tree, (node) => ts.isIdentifier(node) && node.text === "useGlobalSearchParams").length,
    0,
    "the workspace route must not read merged global params",
  );
  const content = fn(tree, "HostWorkspaceRouteContent");
  const params = variable(content, "params", tree).initializer;
  assert.ok(params && ts.isCallExpression(params));
  assert.equal(params.expression.getText(tree), "useLocalSearchParams");
  const open = variable(content, "openValue", tree).initializer;
  assert.ok(open && ts.isCallExpression(open));
  assert.equal(open.expression.getText(tree), "getParamValue");
  assert.deepEqual(
    open.arguments.map((arg) => arg.getText(tree)),
    ["params.open"],
  );
  assert.deepEqual(
    call(content, "useDirectoryDemand", tree).arguments.map((arg) => arg.getText(tree)),
    ["serverId"],
  );
});

test("legacy open links seed the layout model before clearing their own query parameter", () => {
  const tree = source(routeFile);
  const content = fn(tree, "HostWorkspaceRouteContent");
  const prepare = call(content, "prepareWorkspaceTab", tree);
  assert.equal(property(prepare.arguments[0], "serverId", tree).getText(tree), "serverId");
  assert.equal(property(prepare.arguments[0], "workspaceId", tree).getText(tree), "workspaceId");
  assert.equal(
    property(prepare.arguments[0], "target", tree).getText(tree),
    "getOpenIntentTarget(openIntent)",
  );
  assert.equal(
    property(prepare.arguments[0], "pin", tree).getText(tree),
    'openIntent.kind === "agent"',
  );
  assert.equal(
    property(prepare.arguments[1], "openTab", tree).getText(tree),
    "useWorkspaceLayoutStore.getState().deferOpenTab",
  );
  const effect = call(content, "useLayoutEffect", tree);
  assert.ok(findAll(effect, (node) => node === prepare).length === 1);
  const clear = call(effect, "clearConsumedOpenIntent", tree);
  assert.ok(prepare.pos < clear.pos, "save the target before removing the legacy query");
  assert.match(property(clear.arguments[0], "navigation", tree).getText(tree), /^navigation\b/);
  const clearBody = fn(tree, "clearConsumedOpenIntent");
  assert.equal(
    call(clearBody, "input.navigation.setParams", tree).arguments[0].getText(tree),
    "{ open: undefined }",
  );
  assert.match(
    clearBody.getText(tree),
    /window\.setTimeout\(stripOpenSearchParamFromBrowserUrl, 0\)/,
    "the browser URL must also lose the consumed query after Expo commits it",
  );
});

test("known workspace targets open after layout hydration; unknown targets stay in the model", () => {
  const tree = source("packages/app/src/stores/navigation-active-workspace-store/navigation.ts");
  const navigate = fn(tree, "navigateToWorkspace");
  // RC-I-21c: cached workspace knowledge may open directly once layout hydration is complete.
  // Otherwise model state survives startup and can later drive missing-workspace recovery.
  assert.equal(
    variable(navigate, "workspaces", tree).initializer.getText(tree),
    "deps.getSessionWorkspaces(input.serverId)",
  );
  assert.equal(
    variable(navigate, "shouldDeferOpen", tree).initializer.getText(tree),
    "!resolvedWorkspaceId || !deps.isWorkspaceLayoutHydrated()",
  );
  const open = variable(navigate, "openTab", tree).initializer;
  assert.match(open.getText(tree), /if \(shouldDeferOpen\) return deps\.deferOpenTab\(request\)/);
  assert.equal(call(open, "deps.openTab", tree).arguments[0].getText(tree), "request");
  assert.equal(
    property(call(navigate, "prepareWorkspaceTab", tree).arguments[1], "openTab", tree).getText(
      tree,
    ),
    "openTab",
  );
  assert.deepEqual(
    call(navigate, "buildHostWorkspaceRoute", tree).arguments.map((arg) => arg.getText(tree)),
    ["input.serverId", "input.workspaceId"],
    "internal navigation must not serialize another ?open handoff",
  );
});

test("a pending open belongs to one workspace and is consumed after directory and layout hydration", () => {
  const tree = source("packages/app/src/stores/workspace-layout-store.ts");
  const hook = fn(tree, "usePendingWorkspaceOpen");
  assert.equal(
    variable(hook, "workspaceReady", tree).initializer.getText(tree),
    "hasHydratedWorkspaces && workspaceExists",
  );
  assert.match(
    variable(hook, "pending", tree).initializer.getText(tree),
    /workspaceKey \? state\.pendingOpenByWorkspace\[workspaceKey\] : undefined/,
  );
  assert.equal(
    variable(hook, "layoutHydrated", tree).initializer.getText(tree),
    "useWorkspaceLayoutStoreHydrated()",
  );
  const consume = call(hook, "useWorkspaceLayoutStore.getState().consumePendingOpen", tree);
  assert.equal(consume.arguments[0].getText(tree), "workspaceKey");
  let condition = consume.parent;
  while (condition && !ts.isIfStatement(condition)) condition = condition.parent;
  assert.ok(condition, "pending consumption must be gated");
  assert.equal(
    condition.expression.getText(tree),
    "workspaceKey && workspaceReady && layoutHydrated && pending",
  );
  assert.match(
    hook.getText(tree),
    /return pending \? pending\.target : null;/,
    "the pending target remains available for recovery while consumption is blocked",
  );
  const consumers = findAll(
    tree,
    (node) => ts.isPropertyAssignment(node) && node.name.getText(tree) === "consumePendingOpen",
  );
  assert.equal(consumers.length, 1);
  const consumer = consumers[0].initializer;
  assert.match(
    consumer.getText(tree),
    /const \{ \[workspaceKey\]: _pending, \.\.\.pendingOpenByWorkspace \}/,
  );
  const remove = call(consumer, "set", tree);
  const open = call(consumer, "get().openTab", tree);
  assert.ok(remove.pos < open.pos, "remove this workspace's pending target before opening it once");
  assert.equal(open.arguments[0].getText(tree), "pending");
});

test("missing-workspace recovery uses the same pending agent and this connection's directory", () => {
  const tree = source("packages/app/src/screens/workspace/workspace-screen.tsx");
  const pending = variable(tree, "pendingOpenTarget", tree).initializer;
  assert.ok(ts.isCallExpression(pending));
  assert.equal(pending.expression.getText(tree), "usePendingWorkspaceOpen");
  const readiness = pending.arguments[0];
  assert.equal(property(readiness, "workspaceKey", tree).getText(tree), "persistenceKey");
  assert.equal(
    property(readiness, "workspaceExists", tree).getText(tree),
    "workspaceDescriptor !== null",
  );
  assert.equal(
    property(readiness, "hasHydratedWorkspaces", tree).getText(tree),
    "hasHydratedWorkspaces",
  );
  assert.equal(property(readiness, "onOpened", tree).getText(tree), "revealWorkspaceTab");
  const recovery = call(tree, "useWorkspaceRecovery", tree);
  const enabled = property(recovery.arguments[0], "enabled", tree);
  assert.ok(ts.isCallExpression(enabled));
  assert.equal(enabled.expression.getText(tree), "shouldInspectWorkspaceRecovery");
  assert.deepEqual(
    enabled.arguments.map((arg) => arg.getText(tree)),
    ["hasSettledWorkspaces", "workspaceDescriptor", "pendingOpenTarget"],
  );
  const settled = variable(tree, "hasSettledWorkspaces", tree).initializer;
  assert.equal(settled.expression.getText(tree), "hasSettledWorkspaceDirectory");
  assert.equal(
    property(settled.arguments[0], "directoryRefreshSettled", tree).getText(tree),
    "directoryRefreshSettled",
  );
  assert.equal(
    variable(tree, "directoryRefreshSettled", tree).initializer.getText(tree),
    "useDirectoryRefreshSettled(normalizedServerId)",
  );
  const decision = fn(tree, "shouldInspectWorkspaceRecovery");
  assert.match(
    decision.getText(tree),
    /return pendingOpenTarget\?\.kind === "agent" && hasHydratedWorkspaces && workspace === null;/,
  );
});
