// Source wiring only. The behavior is covered by
// packages/app/src/notification-open/{model,native,electron}.test.ts and
// packages/app/src/navigation/woowtech-cold-start-tap.test.ts (README section 16, RC-I-21c).
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

function only(nodes, label) {
  assert.equal(nodes.length, 1, `expected one ${label}`);
  return nodes[0];
}

test("the app shell mounts the notification router behind startup readiness", () => {
  const layout = source("packages/app/src/app/_layout.tsx");
  const imported = only(
    findAll(
      layout,
      (node) =>
        ts.isImportDeclaration(node) && node.moduleSpecifier.text === "@/notification-open/react",
    ),
    "notification router import",
  );
  assert.match(imported.importClause.getText(layout), /\bNotificationOpenRouter\b/);
  const mounted = only(
    findAll(
      layout,
      (node) =>
        ts.isJsxSelfClosingElement(node) &&
        node.tagName.getText(layout) === "NotificationOpenRouter",
    ),
    "mounted notification router",
  );
  assert.match(mounted.getText(layout), /startupBlocked=\{startupBlocker\.kind !== "none"\}/);
  assert.equal(
    findAll(
      layout,
      (node) =>
        ts.isJsxSelfClosingElement(node) &&
        node.tagName.getText(layout) === "NotificationOpenBridge",
    ).length,
    1,
    "the startup bridge must remain mounted",
  );
});

test("one process-local router owns taps and its effect returns subscription cleanup", () => {
  const tree = source("packages/app/src/notification-open/react/index.tsx");
  const factory = only(
    findAll(
      tree,
      (node) =>
        ts.isCallExpression(node) &&
        node.expression.getText(tree) === "createNotificationOpenRouter",
    ),
    "notification router factory",
  );
  assert.ok(ts.isVariableDeclaration(factory.parent));
  assert.equal(
    factory.parent.parent.parent.parent,
    tree,
    "the router must live outside React mounts so Android replay stays deduplicated",
  );
  const routerName = factory.parent.name.getText(tree);
  const start = only(
    findAll(
      tree,
      (node) =>
        ts.isCallExpression(node) && node.expression.getText(tree) === `${routerName}.start`,
    ),
    "router start",
  );
  assert.ok(
    ts.isArrowFunction(start.parent) && start.parent.body === start,
    "the effect must return start()'s unsubscribe",
  );
  assert.ok(ts.isCallExpression(start.parent.parent));
  assert.equal(start.parent.parent.expression.getText(tree), "useEffect");
  assert.equal(start.parent.parent.arguments[1].getText(tree), "[]");
  assert.match(factory.arguments[0].getText(tree), /source:\s*createNotificationOpenSource\(\)/);
  assert.match(
    factory.arguments[0].getText(tree),
    /openAgent:\s*\(target\)\s*=>\s*navigateToAgent\(\{\s*\.\.\.target,\s*pin:\s*true\s*\}\)/,
  );
  assert.match(factory.arguments[0].getText(tree), /openTerminal:[\s\S]*navigateToWorkspace\(/);
  // Only the native source reads launch responses or installs Expo listeners.
  for (const name of [
    "getLastNotificationResponseAsync",
    "addNotificationResponseReceivedListener",
  ]) {
    assert.equal(findAll(tree, (node) => ts.isIdentifier(node) && node.text === name).length, 0);
  }
  const readiness = only(
    findAll(
      tree,
      (node) => ts.isVariableDeclaration(node) && node.name.getText(tree) === "canNavigate",
    ),
    "navigation readiness",
  ).initializer.getText(tree);
  for (const gate of [
    /root\?\.key/,
    /registryStatus === "ready"/,
    /selectionHydrated/,
    /!startupBlocked/,
    /!atStartupIndex/,
  ]) {
    assert.match(readiness, gate);
  }
  assert.match(tree.text, /ready = canNavigate;/);
  assert.match(
    factory.arguments[0].getText(tree),
    /whenReadyToNavigate:[\s\S]*waiters\.add\(resolve\)/,
  );
});

test("native delivery uses the Expo adapter and acknowledges separately from reading", () => {
  const native = source("packages/app/src/notification-open/native.ts");
  const entry = read("packages/app/src/notification-open/source.native.ts");
  assert.match(entry, /import \* as Notifications from "expo-notifications"/);
  assert.match(entry, /return createNativeNotificationOpenSource\(Notifications\)/);
  const launch = only(
    findAll(
      native,
      (node) => ts.isMethodDeclaration(node) && node.name.getText(native) === "takeLaunchTap",
    ),
    "native launch reader",
  );
  assert.match(launch.getText(native), /notifications\.getLastNotificationResponseAsync\(\)/);
  assert.doesNotMatch(launch.getText(native), /clearLastNotificationResponse/);
  const acknowledge = only(
    findAll(
      native,
      (node) => ts.isMethodDeclaration(node) && node.name.getText(native) === "acknowledge",
    ),
    "native acknowledgement",
  );
  assert.match(acknowledge.getText(native), /notifications\.clearLastNotificationResponse\(\)/);
  assert.match(
    native.text,
    /JSON\.stringify\(\[response\.notification\.request\.identifier,\s*response\.notification\.date\]\)/,
    "a later delivery with the same collapse ID must have a different tap identity",
  );
});

test("the F-Droid stub exports every Expo method the native source calls", () => {
  const native = source("packages/app/src/notification-open/native.ts");
  const stub = source("packages/app/src/fdroid/expo-notifications.ts");
  const methods = new Set(
    findAll(
      native,
      (node) =>
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.getText(native) === "notifications",
    ).map((node) => node.expression.name.text),
  );
  assert.deepEqual([...methods].sort(), [
    "addNotificationResponseReceivedListener",
    "clearLastNotificationResponse",
    "getLastNotificationResponseAsync",
    "setNotificationHandler",
  ]);
  for (const name of methods) {
    only(
      findAll(
        stub,
        (node) =>
          ts.isFunctionDeclaration(node) &&
          node.name?.text === name &&
          node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
      ),
      `exported F-Droid ${name}`,
    );
  }
});
