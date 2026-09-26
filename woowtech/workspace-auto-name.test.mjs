import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import { test } from "node:test";
import { importSource } from "./source-modules.mjs";

function source(file) {
  return readFileSync(new URL(`../packages/server/src/${file}`, import.meta.url), "utf8");
}

const { isWorkspaceAutoNameEnabled } = await importSource(
  "packages/server/src/server/woowtech-metadata-policy.ts",
);

test("workspace auto-name is off in the fork policy, not a user setting", () => {
  assert.equal(isWorkspaceAutoNameEnabled(), false);
});

test("both daemon naming entrances reach the policy before any task is scheduled", () => {
  const service = source("server/workspace-auto-name.ts");
  assert.match(
    service,
    /this.isAutoNameEnabled = options.isAutoNameEnabled \?\? isWorkspaceAutoNameEnabled/,
  );
  const worktree = service.slice(
    service.indexOf("  scheduleForWorktree("),
    service.indexOf("  scheduleForDirectory("),
  );
  const directory = service.slice(
    service.indexOf("  scheduleForDirectory("),
    service.indexOf("  private async maybeAutoNameWorkspaceBranch"),
  );
  assert.match(worktree, /this.schedule\(/);
  assert.match(directory, /this.schedule\(/);
  const schedule = service.slice(service.indexOf("  private schedule("));
  assert.match(schedule, /if \(!this.isAutoNameEnabled\(\)\) return;\s*this.scheduleTask\(/);
  const bootstrap = source("server/bootstrap.ts");
  const wiring = bootstrap.slice(
    bootstrap.indexOf("const workspaceAutoName = new WorkspaceAutoName("),
    bootstrap.indexOf("  setupAutoArchiveOnMerge("),
  );
  assert.match(wiring, /new WorkspaceAutoName\(/);
  assert.doesNotMatch(wiring, /isAutoNameEnabled|scheduleTask/);
});

test("the naming policy is separate from commit/PR policy and shared generation", () => {
  assert.doesNotMatch(
    source("server/session/checkout/git-metadata-generator.ts"),
    /isWorkspaceAutoNameEnabled/,
  );
  for (const file of [
    "server/agent/structured-generation-providers.ts",
    "utils/build-metadata-prompt.ts",
  ]) {
    assert.doesNotMatch(source(file), /woowtech-metadata-policy|isWorkspaceAutoNameEnabled/);
  }
});

test("OFF baseline and positive control live in the fork-owned suite", () => {
  const upstream = source("server/workspace-auto-name.test.ts");
  assert.doesNotMatch(upstream, /autoNameOffFixture|woowtech OFF baseline/);
  const fork = source("server/woowtech-workspace-auto-name.test.ts");
  assert.match(fork, /woowtech OFF baseline/);
  assert.match(fork, /explicit upstream test policy/);
  assert.match(upstream, /isAutoNameEnabled: \(\) => true/);
});

const generatorName = "generateBranchNameFromFirstAgentContext";
const generatorModule = /(?:^|\/)worktree-branch-name-generator(?:\.[cm]?[jt]sx?)?$/;

function findWorkspaceNameGeneratorAccesses(files) {
  const accesses = [];
  for (const [file, text] of files) {
    if (file === "server/workspace-auto-name.ts") continue;
    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)) continue;
    if (/(?:^|\/)(?:__tests__|test-utils|fixtures)\//.test(file)) continue;
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    function visit(node) {
      // Reject access, not just calls: an imported alias can escape through a
      // variable, an object property or a re-export before another module calls it.
      const namedAccess = ts.isIdentifier(node) && node.text === generatorName;
      const declaration =
        namedAccess && ts.isFunctionDeclaration(node.parent) && node.parent.name === node;
      const moduleAccess = ts.isStringLiteral(node) && generatorModule.test(node.text);
      const indexedAccess =
        ts.isStringLiteral(node) &&
        node.text === generatorName &&
        ts.isElementAccessExpression(node.parent);
      if ((namedAccess && !declaration) || moduleAccess || indexedAccess) {
        const { line } = tree.getLineAndCharacterOfPosition(node.getStart(tree));
        accesses.push(`${file}:${line + 1}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
  return accesses;
}

function productionSources(
  directory = new URL("../packages/server/src/", import.meta.url),
  prefix = "",
) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = `${prefix}${entry.name}`;
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) return productionSources(url, `${file}/`);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [[file, readFileSync(url, "utf8")]] : [];
  });
}

test("workspace naming generator has no production access outside its gated owner", () => {
  assert.deepEqual(findWorkspaceNameGeneratorAccesses(productionSources()), []);
});

test("caller scan rejects import aliases, indirect references, namespace access and re-exports", () => {
  for (const text of [
    `import { ${generatorName} as renamed } from "./worktree-branch-name-generator.js"; const indirect = renamed; indirect(input);`,
    `import * as naming from "./worktree-branch-name-generator.js"; const indirect = naming["${generatorName}"]; indirect(input);`,
    `export { ${generatorName} as renamed } from "./worktree-branch-name-generator.js";`,
    'export * from "./worktree-branch-name-generator.js";',
    'const naming = await import("./worktree-branch-name-generator.js"); naming.generateBranchNameFromFirstAgentContext(input);',
    `${generatorName}(input);`,
  ]) {
    assert.ok(
      findWorkspaceNameGeneratorAccesses([["server/unexpected-caller.ts", text]]).length > 0,
      text,
    );
  }
});

test("caller scan excludes declarations, comments, tests and the owning service", () => {
  assert.deepEqual(
    findWorkspaceNameGeneratorAccesses([
      [
        "server/worktree-branch-name-generator.ts",
        `export async function ${generatorName}() {} // ${generatorName}()`,
      ],
      ["server/woowtech-workspace-auto-name.test.ts", `${generatorName}(input)`],
      ["server/example.spec.ts", `${generatorName}(input)`],
      ["server/test-utils/fixture.ts", `${generatorName}(input)`],
      [
        "server/workspace-auto-name.ts",
        `import { ${generatorName} } from "./worktree-branch-name-generator.js"; const run = ${generatorName}; run(input);`,
      ],
    ]),
    [],
  );
});
