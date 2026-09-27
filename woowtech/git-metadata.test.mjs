import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import { test } from "node:test";
import { importSource } from "./source-modules.mjs";

function source(file) {
  return readFileSync(new URL(`../packages/server/src/${file}`, import.meta.url), "utf8");
}

const { isGitMetadataGenerationEnabled } = await importSource(
  "packages/server/src/server/woowtech-metadata-policy.ts",
);

test("commit and PR metadata are OFF without consulting environment or home preferences", () => {
  assert.equal(isGitMetadataGenerationEnabled(), false);
  const policy = source("server/woowtech-metadata-policy.ts");
  assert.doesNotMatch(policy, /process\.env|readFile|import\s/);
});

test("both generator entrances gate before prompt construction with the fork default", () => {
  const generator = source("server/session/checkout/git-metadata-generator.ts");
  assert.match(generator, /from "\.\.\/\.\.\/woowtech-metadata-policy\.js"/);
  assert.match(
    generator,
    /const isGenerationEnabled = deps\.isGenerationEnabled \?\? isGitMetadataGenerationEnabled/,
  );
  assert.match(
    generator,
    /async generateCommitMessage\(cwd\) \{\s*if \(!isGenerationEnabled\(\)\) return COMMIT_MESSAGE_FALLBACK;\s*const prompt/,
  );
  assert.match(
    generator,
    /async generatePullRequestText\(cwd, baseRef\) \{\s*if \(!isGenerationEnabled\(\)\) return PULL_REQUEST_FALLBACK;\s*const prompt/,
  );
});

test("production checkout wiring uses the guarded generator without enabling a test override", () => {
  const session = source("server/session.ts");
  const wiring = session.slice(
    session.indexOf("this.checkoutSession = new CheckoutSession({"),
    session.indexOf("this.workspaceGitObserver = createWorkspaceGitObserverService({"),
  );
  assert.match(wiring, /gitMetadataGenerator: createGitMetadataGenerator\(\{/);
  assert.match(wiring, /generation: createAgentStructuredTextGeneration\(\{/);
  assert.doesNotMatch(wiring, /isGenerationEnabled|buildMetadataPrompt/);
});

function policyOverrides(file, text) {
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)) return [];
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const violations = [];
  const forkPolicies = new Set(["isGitMetadataGenerationEnabled", "isWorkspaceAutoNameEnabled"]);
  const policyNames = new Set([...forkPolicies, "isGenerationEnabled", "isAutoNameEnabled"]);
  const writes = new Set([
    ts.SyntaxKind.EqualsToken,
    ts.SyntaxKind.QuestionQuestionEqualsToken,
    ts.SyntaxKind.BarBarEqualsToken,
    ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ]);
  // x.name and x["name"]
  function memberName(node) {
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
      return node.argumentExpression.text;
    }
    return undefined;
  }
  // x.name = options.name ?? forkPolicy keeps the injected option, which is checked where it is
  // passed, or the fork default. Only a plain `=` from `options` qualifies.
  function keepsForkDefault(node, name) {
    const value = node.right;
    return (
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isBinaryExpression(value) &&
      value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
      ts.isPropertyAccessExpression(value.left) &&
      value.left.expression.getText(tree) === "options" &&
      value.left.name.text === name &&
      ts.isIdentifier(value.right) &&
      forkPolicies.has(value.right.text)
    );
  }
  function visit(node) {
    // Members that supply a policy: { name: … }, { name }, name() {}, get name() {}, name = …
    if (
      (ts.isPropertyAssignment(node) ||
        ts.isShorthandPropertyAssignment(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        (ts.isPropertyDeclaration(node) && node.initializer)) &&
      policyNames.has(node.name.getText(tree).replace(/["']/g, ""))
    ) {
      violations.push(file);
    }
    if (ts.isBinaryExpression(node) && writes.has(node.operatorToken.kind)) {
      const name = memberName(node.left);
      if (policyNames.has(name) && !keepsForkDefault(node, name)) violations.push(file);
    }
    // Defaults that supply a policy: const { name = … } = deps, ({ name: local = … }), (name = …)
    if (
      (ts.isBindingElement(node) || ts.isParameter(node)) &&
      node.initializer &&
      [node.propertyName, node.name].some(
        (name) => name && policyNames.has(name.getText(tree).replace(/["']/g, "")),
      )
    ) {
      violations.push(file);
    }
    // A policy named in a string: defineProperty, Reflect.set, a computed key. Reads through
    // x["name"] are fine; writes through it are caught above.
    if (
      ts.isStringLiteralLike(node) &&
      policyNames.has(node.text) &&
      !ts.isElementAccessExpression(node.parent)
    ) {
      violations.push(file);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return [...new Set(violations)];
}

function productionPolicyOverrides(
  directory = new URL("../packages/server/src/", import.meta.url),
  prefix = "",
) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = `${prefix}${entry.name}`;
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) return productionPolicyOverrides(url, `${file}/`);
    return /\.[cm]?[jt]sx?$/.test(file) ? policyOverrides(file, readFileSync(url, "utf8")) : [];
  });
}

test("metadata policy overrides are confined to tests, including the upstream Session mock", () => {
  const override =
    'vi.mock("./woowtech-metadata-policy.js", () => ({ isGitMetadataGenerationEnabled: () => true }));';
  assert.deepEqual(policyOverrides("server/session.test.ts", override), []);
  assert.deepEqual(policyOverrides("server/unexpected.ts", override), ["server/unexpected.ts"]);
  assert.deepEqual(
    policyOverrides("server/unexpected.ts", "factory({ isGenerationEnabled: () => true });"),
    ["server/unexpected.ts"],
  );
  for (const text of [
    "const isGenerationEnabled = () => true; factory({ generation, isGenerationEnabled });",
    "deps.isGenerationEnabled = () => true;",
    'deps["isGenerationEnabled"] = () => true;',
    "this.isAutoNameEnabled = () => true;",
    "this.isAutoNameEnabled = options.isAutoNameEnabled ?? (() => true);",
    "this.isAutoNameEnabled = (() => true) ?? isWorkspaceAutoNameEnabled;",
    "this.isAutoNameEnabled = forced.isAutoNameEnabled ?? isWorkspaceAutoNameEnabled;",
    "deps.isGenerationEnabled ??= () => true;",
    "deps.isGenerationEnabled ||= () => true;",
    "this.isAutoNameEnabled &&= () => true;",
    "this.isAutoNameEnabled ??= options.isAutoNameEnabled ?? isWorkspaceAutoNameEnabled;",
    'factory({ "isGenerationEnabled": () => true });',
    'Object.defineProperty(deps, "isGenerationEnabled", { value: () => true });',
    'const key = "isGenerationEnabled"; factory({ [key]: () => true });',
    "class Stub { isAutoNameEnabled = () => true; }",
    "factory({ get isGenerationEnabled() { return () => true; } });",
    "const { isGenerationEnabled = () => true } = deps;",
    "const { isGenerationEnabled: enabled = () => true } = deps;",
    "export function make({ isGenerationEnabled = () => true }: Deps) {}",
    "export function make(isAutoNameEnabled = () => true) {}",
  ]) {
    assert.deepEqual(
      policyOverrides("server/unexpected.ts", text),
      ["server/unexpected.ts"],
      `not flagged: ${text}`,
    );
  }
  // Declaring or calling a policy is not an override.
  for (const text of [
    "interface Deps { isGenerationEnabled?: () => boolean }",
    "class Real { private readonly isAutoNameEnabled: () => boolean; }",
    "if (!isGenerationEnabled()) return COMMIT_MESSAGE_FALLBACK;",
    'if (!deps["isGenerationEnabled"]?.()) return COMMIT_MESSAGE_FALLBACK;',
    "const { isGenerationEnabled } = deps;",
    "export function make({ isGenerationEnabled }: Deps, isAutoNameEnabled: () => boolean) {}",
  ]) {
    assert.deepEqual(policyOverrides("server/unexpected.ts", text), [], `flagged: ${text}`);
  }
  // The one production write: WorkspaceAutoName keeps the injected option or the fork policy.
  assert.deepEqual(
    policyOverrides(
      "server/unexpected.ts",
      "this.isAutoNameEnabled = options.isAutoNameEnabled ?? isWorkspaceAutoNameEnabled;",
    ),
    [],
  );
  assert.deepEqual(productionPolicyOverrides(), []);
  assert.match(source("server/session.test.ts"), /isGitMetadataGenerationEnabled: \(\) => true/);
});
