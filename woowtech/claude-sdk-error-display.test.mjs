// node --test woowtech/claude-sdk-error-display.test.mjs
// Source wiring only. Which text is translated is covered by
// packages/app/src/utils/claude-sdk-error.test.ts; the daemon's row for a failed download by
// packages/server/src/server/agent/providers/claude/woowtech-claude-sdk-retry.test.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const helpers = "@/utils/claude-sdk-error";

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
function importedNames(tree, specifier) {
  return findAll(
    tree,
    (node) => ts.isImportDeclaration(node) && node.moduleSpecifier.text === specifier,
  ).flatMap((node) => {
    const bindings = node.importClause?.namedBindings;
    return bindings && ts.isNamedImports(bindings)
      ? bindings.elements.map((element) => element.name.text)
      : [];
  });
}
function declaration(tree, name) {
  const matches = findAll(
    tree,
    (node) => ts.isVariableDeclaration(node) && node.name.getText(tree) === name,
  );
  assert.equal(matches.length, 1, `expected one declaration of ${name}`);
  return matches[0];
}
function calls(scope, name, tree) {
  return findAll(
    scope,
    (node) => ts.isCallExpression(node) && node.expression.getText(tree) === name,
  );
}
function jsxElements(scope, tag, tree) {
  return findAll(
    scope,
    (node) =>
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      node.tagName.getText(tree) === tag,
  );
}
function jsxAttribute(element, name, tree) {
  return element.attributes.properties.find(
    (property) => ts.isJsxAttribute(property) && property.name.getText(tree) === name,
  )?.initializer;
}

test("the timeline shows the daemon's failed-turn row for a Claude SDK error as the notice", () => {
  // The daemon writes a failed turn as an assistant row, `[System Error] <error>`, so the desktop
  // app showed the loader's raw English text: only the Notification row was translated.
  const tree = source("packages/app/src/agent-stream/view.tsx");
  assert.ok(importedNames(tree, helpers).includes("claudeSdkSystemErrorMessage"));
  const renderer = declaration(tree, "renderAssistantMessageItem");
  const [read, ...others] = calls(renderer, "claudeSdkSystemErrorMessage", tree);
  assert.ok(
    read,
    "renderAssistantMessageItem must read the row through claudeSdkSystemErrorMessage",
  );
  assert.equal(others.length, 0);
  assert.deepEqual(
    read.arguments.map((argument) => argument.getText(tree)),
    ["item.text"],
  );
  assert.ok(ts.isVariableDeclaration(read.parent), "keep the SDK error in a variable");
  const sdkError = read.parent.name.getText(tree);
  const notices = jsxElements(renderer, "Notification", tree);
  assert.equal(notices.length, 1, "the SDK error renders as one Notification");
  assert.equal(jsxAttribute(notices[0], "level", tree)?.getText(tree), '"error"');
  assert.equal(jsxAttribute(notices[0], "message", tree)?.expression?.getText(tree), sdkError);
  // Every other row, including other failed turns, stays the agent's message.
  assert.equal(jsxElements(renderer, "AssistantMessage", tree).length, 1);
});

test("the Notification row translates the fork's SDK errors by level and message", () => {
  const tree = source("packages/app/src/components/message.tsx");
  assert.ok(importedNames(tree, helpers).includes("claudeSdkErrorTranslationKey"));
  const [translate, ...others] = calls(
    declaration(tree, "Notification"),
    "claudeSdkErrorTranslationKey",
    tree,
  );
  assert.ok(translate, "Notification must translate through claudeSdkErrorTranslationKey");
  assert.equal(others.length, 0);
  assert.deepEqual(
    translate.arguments.map((argument) => argument.getText(tree)),
    ["level", "message"],
  );
});
