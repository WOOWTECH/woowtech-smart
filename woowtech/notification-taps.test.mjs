// Source wiring only. The behavior is covered by
// packages/app/src/navigation/woowtech-notification-response.test.ts and
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

test("PushNotificationRouter hands taps over through subscribeToNotificationTaps", () => {
  const file = "packages/app/src/app/_layout.tsx";
  const tree = source(file);
  const [router] = findAll(
    tree,
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "PushNotificationRouter",
  );
  assert.ok(router, "PushNotificationRouter not found");
  const calls = findAll(
    router,
    (node) =>
      ts.isCallExpression(node) && node.expression.getText(tree) === "subscribeToNotificationTaps",
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(
    calls[0].arguments.map((argument) => argument.getText(tree)),
    ["Notifications", "openNotification"],
  );
  assert.ok(
    ts.isReturnStatement(calls[0].parent),
    "the effect must return the unsubscribe from subscribeToNotificationTaps",
  );
  // A per-mount de-dupe and a second read of the last response are what replayed taps.
  for (const name of [
    "getLastNotificationResponseAsync",
    "addNotificationResponseReceivedListener",
  ]) {
    assert.equal(
      findAll(router, (node) => ts.isIdentifier(node) && node.text === name).length,
      0,
      `PushNotificationRouter must not call ${name} itself`,
    );
  }
});

test("the F-Droid expo-notifications stub has what subscribeToNotificationTaps calls", () => {
  const stub = read("packages/app/src/fdroid/expo-notifications.ts");
  for (const name of [
    "getLastNotificationResponse",
    "clearLastNotificationResponse",
    "addNotificationResponseReceivedListener",
  ]) {
    assert.match(stub, new RegExp(`export function ${name}\\(`), `the stub must export ${name}`);
  }
});
