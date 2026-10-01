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

test("the workspace route reads the open intent from its own route params", () => {
  const tree = source(routeFile);
  // expo-router copies ?open onto the h/[serverId] route when a notification enters the workspace
  // from outside the host stack. useGlobalSearchParams merges that copy back in after every later
  // workspace switch, and the route reopens the agent there (the Android S3 failure).
  assert.equal(
    findAll(tree, (node) => ts.isIdentifier(node) && node.text === "useGlobalSearchParams").length,
    0,
    "the workspace route must not read useGlobalSearchParams",
  );
  const imports = findAll(
    tree,
    (node) =>
      ts.isImportDeclaration(node) &&
      node.moduleSpecifier.text === "@/navigation/woowtech-workspace-open-intent",
  );
  assert.equal(imports.length, 1);
  assert.match(imports[0].importClause.getText(tree), /\breadWorkspaceRouteOpenParam\b/);

  const [content] = findAll(
    tree,
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "HostWorkspaceRouteContent",
  );
  assert.ok(content, "HostWorkspaceRouteContent not found");
  const openValue = variable(content, "openValue", tree).initializer;
  assert.ok(openValue && ts.isCallExpression(openValue));
  assert.equal(openValue.expression.getText(tree), "readWorkspaceRouteOpenParam");
  assert.equal(openValue.arguments.length, 1);
  const paramsName = openValue.arguments[0].getText(tree);
  const params = variable(content, paramsName, tree).initializer;
  assert.ok(params && ts.isCallExpression(params));
  assert.equal(
    params.expression.getText(tree),
    "useLocalSearchParams",
    `${paramsName} must be the route's own params`,
  );
});

test("an agent intent waits only while the store does not know its workspace (RC-I-21c)", () => {
  const tree = source(routeFile);
  const imports = findAll(
    tree,
    (node) =>
      ts.isImportDeclaration(node) &&
      node.moduleSpecifier.text === "@/navigation/woowtech-workspace-open-intent",
  );
  assert.match(imports[0].importClause.getText(tree), /\bisAgentOpenIntentWaitingForWorkspace\b/);

  const [content] = findAll(
    tree,
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "HostWorkspaceRouteContent",
  );
  assert.ok(content, "HostWorkspaceRouteContent not found");
  // Waiting for the live directory (hasHydratedWorkspaces) kept the remembered agent on screen
  // after a cold-start tap, though the cached directory already knew the workspace. The vitest
  // harnesses call isAgentOpenIntentWaitingForWorkspace the way this line does, so putting the
  // upstream line back turns this guard red.
  const waiting = variable(content, "isOpenIntentWaitingForWorkspace", tree).initializer;
  assert.ok(waiting && ts.isCallExpression(waiting));
  assert.equal(waiting.expression.getText(tree), "isAgentOpenIntentWaitingForWorkspace");
  assert.equal(waiting.arguments.length, 1);
  const [argument] = waiting.arguments;
  assert.ok(ts.isObjectLiteralExpression(argument));
  assert.deepEqual(
    argument.properties.map((property) => property.getText(tree)),
    ["openIntent", "workspaceExists"],
  );
  const workspaceExists = variable(content, "workspaceExists", tree).initializer;
  assert.equal(
    workspaceExists?.getText(tree),
    "useWorkspaceExists(serverId, workspaceId)",
    "workspaceExists must be the store's answer, cached directory included",
  );
  // hasHydratedWorkspaces only feeds the recovery latch below, never the wait.
  const latchCalls = new Set(["shouldLatchWorkspaceRecovery", "isWorkspaceRecoveryLatchHeld"]);
  for (const use of findAll(
    content,
    (node) => ts.isIdentifier(node) && node.text === "hasHydratedWorkspaces",
  )) {
    if (ts.isVariableDeclaration(use.parent) && use.parent.name === use) continue;
    if (ts.isArrayLiteralExpression(use.parent)) continue; // an effect's dependency list
    let ancestor = use.parent;
    while (ancestor && !ts.isCallExpression(ancestor)) ancestor = ancestor.parent;
    assert.ok(
      ancestor && latchCalls.has(ancestor.expression.getText(tree)),
      `the route must not wait for the live directory: ${use.parent.getText(tree)}`,
    );
  }
});

test("an agent intent consumed before the live directory keeps recovery requested (RC-I-21c)", () => {
  const tree = source(routeFile);
  const imports = findAll(
    tree,
    (node) =>
      ts.isImportDeclaration(node) &&
      node.moduleSpecifier.text === "@/navigation/woowtech-workspace-open-intent",
  );
  const imported = imports[0].importClause.getText(tree);
  assert.match(imported, /\bshouldLatchWorkspaceRecovery\b/);
  assert.match(imported, /\bisWorkspaceRecoveryLatchHeld\b/);

  const [content] = findAll(
    tree,
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "HostWorkspaceRouteContent",
  );
  assert.ok(content, "HostWorkspaceRouteContent not found");
  // Upstream #2002 requested recovery while ?open=agent waited for the live directory. The intent
  // is now consumed against the cached directory, so without the latch a workspace archived while
  // the app was killed showed 「Workspace unavailable」 instead of Restore.
  const held = variable(content, "isRecoveryLatchHeld", tree).initializer;
  assert.ok(held && ts.isCallExpression(held));
  assert.equal(held.expression.getText(tree), "isWorkspaceRecoveryLatchHeld");

  const latches = findAll(
    content,
    (node) =>
      ts.isCallExpression(node) && node.expression.getText(tree) === "shouldLatchWorkspaceRecovery",
  );
  assert.equal(latches.length, 1);
  const latch = latches[0];
  assert.ok(ts.isIfStatement(latch.parent), "the latch is set where the intent is consumed");
  assert.match(latch.parent.thenStatement.getText(tree), /\bsetRecoveryLatchKey\(/);
  let effect = latch.parent;
  while (
    effect &&
    !(ts.isCallExpression(effect) && effect.expression.getText(tree) === "useEffect")
  ) {
    effect = effect.parent;
  }
  assert.ok(effect, "the latch is set in the open-intent effect");
  assert.match(effect.getText(tree), /\bprepareWorkspaceTab\(/);

  const decks = findAll(
    content,
    (node) =>
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      node.tagName.getText(tree) === "WorkspaceDeck",
  );
  assert.equal(decks.length, 1);
  const requested = decks[0].attributes.properties.find(
    (attribute) => attribute.name?.getText(tree) === "recoveryRequested",
  );
  assert.equal(requested?.initializer?.getText(tree), "{isAgentOpenIntent || isRecoveryLatchHeld}");
});
