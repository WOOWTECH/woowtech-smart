// Source wiring only. The navigation behavior, including the Android run where the first tap after
// pairing lost the agent, is covered by
// packages/app/src/navigation/woowtech-welcome-host-online.test.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const screenFile = "packages/app/src/components/welcome-screen.tsx";

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
function importedFrom(tree, moduleName) {
  return findAll(
    tree,
    (node) => ts.isImportDeclaration(node) && node.moduleSpecifier.text === moduleName,
  ).map((node) => node.importClause.getText(tree));
}
function isCallTo(node, name, tree) {
  return ts.isCallExpression(node) && node.expression.getText(tree) === name;
}

test("the welcome screen moves on to the host only while it is focused", () => {
  const tree = source(screenFile);
  // Pairing through a link or the QR scanner leaves the welcome screen under the root stack, and
  // router.replace replaces the focused route: an unguarded effect turned the workspace a tapped
  // notification had opened into /open-project when the host came back online.
  assert.match(
    importedFrom(tree, "@/navigation/woowtech-welcome-host-online").join(),
    /\bshouldWelcomeMoveOnToHost\b/,
  );
  assert.match(importedFrom(tree, "@react-navigation/native").join(), /\buseIsFocused\b/);

  const [screen] = findAll(
    tree,
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "WelcomeScreen",
  );
  assert.ok(screen, "WelcomeScreen not found");
  const isFocused = findAll(
    screen,
    (node) => ts.isVariableDeclaration(node) && node.name.getText(tree) === "isFocused",
  );
  assert.equal(isFocused.length, 1, "expected one isFocused");
  assert.ok(isCallTo(isFocused[0].initializer, "useIsFocused", tree), "isFocused = useIsFocused()");

  // Every effect of the screen that navigates is the guarded host-online effect.
  const navigatingEffects = findAll(screen, (node) => isCallTo(node, "useEffect", tree)).filter(
    (effect) => findAll(effect, (node) => node.getText(tree).startsWith("router.")).length > 0,
  );
  assert.equal(navigatingEffects.length, 1, "expected one navigating effect");
  const [body, deps] = navigatingEffects[0].arguments;
  const [first] = body.body.statements;
  assert.ok(first && ts.isIfStatement(first), "the effect starts with the guard");
  assert.equal(
    first.expression.getText(tree).replace(/\s+/g, " "),
    "!shouldWelcomeMoveOnToHost({ anyOnlineServerId, isFocused })",
  );
  assert.ok(ts.isReturnStatement(first.thenStatement), "the guard returns");
  const depNames = new Set(deps.elements.map((element) => element.getText(tree)));
  assert.ok(depNames.has("anyOnlineServerId"), "anyOnlineServerId is a dependency");
  assert.ok(depNames.has("isFocused"), "isFocused is a dependency");
});
