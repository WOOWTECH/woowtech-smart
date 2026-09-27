// Source wiring only. The navigation behavior, including the Android S2 -> S3 sequence, is covered
// by packages/app/src/navigation/woowtech-workspace-open-intent.test.ts.
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
