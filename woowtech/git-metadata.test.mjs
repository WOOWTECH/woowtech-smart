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
  const policyNames = new Set([
    "isGitMetadataGenerationEnabled",
    "isWorkspaceAutoNameEnabled",
    "isGenerationEnabled",
    "isAutoNameEnabled",
  ]);
  function visit(node) {
    if (
      (ts.isPropertyAssignment(node) || ts.isMethodDeclaration(node)) &&
      policyNames.has(node.name.getText(tree).replace(/["']/g, ""))
    ) {
      violations.push(file);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return violations;
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
  assert.deepEqual(productionPolicyOverrides(), []);
  assert.match(source("server/session.test.ts"), /isGitMetadataGenerationEnabled: \(\) => true/);
});
