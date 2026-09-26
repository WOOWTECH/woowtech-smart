// Source wiring only, not React hook execution or GUI evidence. Behavior is covered by
// packages/app/src/screens/workspace/missing-workspace-directory-demand.test.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

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
function calls(tree, name) {
  return findAll(
    tree,
    (node) => ts.isCallExpression(node) && node.expression.getText(tree) === name,
  );
}
function properties(node, tree) {
  assert.ok(node && ts.isObjectLiteralExpression(node));
  return Object.fromEntries(
    node.properties.map((property) => {
      assert.ok(ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property));
      return [
        property.name.getText(tree),
        ts.isShorthandPropertyAssignment(property)
          ? property.name.getText(tree)
          : property.initializer.getText(tree),
      ];
    }),
  );
}

const base = "packages/app/src/screens/workspace/";
test("workspace-screen wires the focused missing descriptor owner beside cache preparation", () => {
  const tree = source(`${base}workspace-screen.tsx`);
  const imports = findAll(
    tree,
    (node) =>
      ts.isImportDeclaration(node) &&
      node.moduleSpecifier.text === "./use-missing-workspace-directory-demand",
  );
  assert.equal(imports.length, 1);
  assert.match(imports[0].importClause.getText(tree), /\buseMissingWorkspaceDirectoryDemand\b/);
  const matches = calls(tree, "useMissingWorkspaceDirectoryDemand");
  assert.equal(matches.length, 1, "missing or duplicate workspace demand hook call");
  const call = matches[0];
  assert.deepEqual(properties(call.arguments[0], tree), {
    serverId: "normalizedServerId",
    workspaceId: "normalizedWorkspaceId",
    isRouteFocused: "isRouteFocused",
    hasWorkspaceDescriptor: "workspaceDescriptor !== null",
  });
  assert.ok(ts.isExpressionStatement(call.parent));
  const statements = call.parent.parent.statements;
  assert.ok(statements, "hook must be an unconditional screen-level call");
  const next = statements[statements.indexOf(call.parent) + 1].getText(tree);
  assert.match(next, /useEffect\(/);
  assert.match(next, /\.prepareWorkspaceRoute\(normalizedServerId, normalizedWorkspaceId\)/);
});

test("hook returns its directory cleanup and tracks identity, focus and descriptor presence", () => {
  const tree = source(`${base}use-missing-workspace-directory-demand.ts`);
  const effects = calls(tree, "useEffect");
  assert.equal(effects.length, 1);
  const [setup, dependencies] = effects[0].arguments;
  assert.ok(ts.isArrowFunction(setup));
  assert.ok(
    ts.isCallExpression(setup.body),
    "effect must return the acquisition cleanup, not discard it",
  );
  assert.equal(setup.body.expression.getText(tree), "acquireMissingWorkspaceDirectoryDemand");
  assert.equal(setup.body.arguments[0].getText(tree), "getHostRuntimeStore()");
  assert.deepEqual(properties(setup.body.arguments[1], tree), {
    serverId: "serverId",
    workspaceId: "workspaceId",
    isRouteFocused: "isRouteFocused",
    hasWorkspaceDescriptor: "hasWorkspaceDescriptor",
  });
  assert.ok(ts.isArrayLiteralExpression(dependencies));
  assert.deepEqual(
    dependencies.elements.map((element) => element.getText(tree)),
    ["serverId", "workspaceId", "isRouteFocused", "hasWorkspaceDescriptor"],
  );
});
