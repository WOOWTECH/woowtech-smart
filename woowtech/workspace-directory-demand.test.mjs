// Source wiring only, not React hook execution or GUI evidence. Behavior, including the directory
// sync race fix pinned at the end, is covered by
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
// A return that leaves the component itself; nested functions return only from themselves.
function returnsFromComponent(node) {
  if (ts.isReturnStatement(node)) return true;
  if (ts.isFunctionLike(node)) return false;
  return ts.forEachChild(node, returnsFromComponent) ?? false;
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
  // Rules of hooks: one plain statement of the component body, reached on every render.
  const components = findAll(
    tree,
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "WorkspaceScreenContent",
  );
  assert.equal(components.length, 1, "WorkspaceScreenContent component not found");
  const body = components[0].body;
  assert.ok(
    ts.isExpressionStatement(call.parent) && call.parent.parent === body,
    "hook must be a direct statement of WorkspaceScreenContent, not inside if, ?:, &&, a block or a callback",
  );
  const statements = body.statements;
  const index = statements.indexOf(call.parent);
  assert.ok(
    !statements.slice(0, index).some(returnsFromComponent),
    "hook must run before any early return of WorkspaceScreenContent",
  );
  const next = statements[index + 1].getText(tree);
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

// The race fix lives in an upstream file (woowtech/README.md, 16 T1). A merge that takes upstream's
// requestDemandRefresh or releaseSubscriptions drops it without a conflict, so pin its four parts.
test("directory sync never lets a refresh that outlived its subscriptions satisfy the connection", () => {
  const tree = source("packages/app/src/runtime/directory-sync/index.ts");
  const text = (node) => node.getText(tree).replace(/\s+/g, " ");
  const method = (name) => {
    const found = findAll(
      tree,
      (node) => ts.isMethodDeclaration(node) && node.name.getText(tree) === name,
    );
    assert.equal(found.length, 1, `DirectorySync.${name} not found`);
    return found[0];
  };
  const isGeneration = (node) => text(node) === "this.subscriptionGeneration";
  const bumps = (node) =>
    (ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken &&
      isGeneration(node.left) &&
      text(node.right) === "1") ||
    ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      node.operator === ts.SyntaxKind.PlusPlusToken &&
      isGeneration(node.operand));
  assert.ok(
    method("releaseSubscriptions").body.statements.some(
      (statement) => ts.isExpressionStatement(statement) && bumps(statement.expression),
    ),
    "releaseSubscriptions must count every drop: this.subscriptionGeneration += 1",
  );

  const refresh = method("requestDemandRefresh");
  const statements = refresh.body.statements;
  const check = statements.findIndex(
    (statement) =>
      ts.isIfStatement(statement) &&
      text(statement.expression).includes("this.satisfiedDemandSource?."),
  );
  const start = statements.findIndex(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(
        (declaration) => declaration.name.getText(tree) === "refresh",
      ),
  );
  assert.ok(check >= 0 && start > check, "satisfied check or refresh start not found");
  const between = new Set(statements.slice(check + 1, start).map(text));
  assert.ok(
    between.has("this.satisfiedDemandSource = null;") &&
      between.has("const generation = this.subscriptionGeneration;"),
    "after the satisfied check, clear the mark and capture the generation before the refresh starts",
  );

  const satisfies = findAll(
    tree,
    (node) =>
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      text(node.left) === "this.satisfiedDemandSource" &&
      node.right.kind !== ts.SyntaxKind.NullKeyword,
  );
  assert.ok(satisfies.length > 0, "no write marks the connection satisfied");
  for (const node of satisfies) {
    let guarded = false;
    for (let child = node; child.parent && !guarded; child = child.parent) {
      guarded =
        ts.isIfStatement(child.parent) &&
        child.parent.thenStatement === child &&
        text(child.parent.expression) === "generation === this.subscriptionGeneration";
    }
    assert.ok(
      guarded,
      `${text(node)} must sit under if (generation === this.subscriptionGeneration)`,
    );
  }

  const finallies = findAll(
    refresh,
    (node) =>
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "finally",
  );
  assert.equal(finallies.length, 1, "demand refresh must keep one finally");
  const retries = findAll(
    finallies[0].arguments[0],
    (node) =>
      ts.isIfStatement(node) &&
      text(node.expression).includes("generation !== this.subscriptionGeneration") &&
      text(node.thenStatement).includes("this.requestDemandRefresh()"),
  );
  assert.equal(retries.length, 1, "finally must refresh again when subscriptions were dropped");
});

// While the missing-workspace owner holds demand, opening the sidebar is not the host's first
// demand, so without this a failed refresh waits for a reconnect (woowtech/README.md, 16 T1).
test("directory sync retries an unsatisfied connection when another directory owner joins", () => {
  const tree = source("packages/app/src/runtime/directory-sync/index.ts");
  const text = (node) => node.getText(tree).replace(/\s+/g, " ");
  const setDemand = findAll(
    tree,
    (node) => ts.isMethodDeclaration(node) && node.name.getText(tree) === "setDemand",
  );
  assert.equal(setDemand.length, 1, "DirectorySync.setDemand not found");
  const joins = findAll(
    setDemand[0],
    (node) =>
      ts.isIfStatement(node) &&
      /\bdemanded\b/.test(text(node.expression)) &&
      text(node.thenStatement).includes("this.requestDemandRefresh()"),
  );
  assert.equal(
    joins.length,
    1,
    "setDemand must call this.requestDemandRefresh() when an owner joins: if (demanded && …)",
  );
});
