// node --test woowtech/claude-sdk.test.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { sdkName, runtimePath, sdkValueImports } from "./claude-sdk-imports.mjs";
import { repoRoot, shippedSourceFiles } from "./shipped-sources.mjs";

const manifest = (file) => JSON.parse(readFileSync(path.join(repoRoot, file), "utf8"));

test("SDK stays development-only, undici is a direct server production dependency", () => {
  const server = manifest("packages/server/package.json");
  assert.equal(server.devDependencies[sdkName], "0.3.246");
  for (const name of readdirSync(path.join(repoRoot, "packages"))) {
    const pkg = manifest(`packages/${name}/package.json`);
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      assert.equal(pkg[field]?.[sdkName], undefined, `${name}: ${field}`);
    }
  }
  assert.equal(server.dependencies.undici, "^7.24.8");
  assert.equal(
    manifest("package-lock.json").packages["packages/server"].dependencies.undici,
    server.dependencies.undici,
  );
});

test("AST rejects every value loading form outside the loader", () => {
  for (const source of [
    `import { query } from '${sdkName}';`,
    `import { type Query, query } from '${sdkName}';`,
    `import '${sdkName}';`,
    `export { query } from '${sdkName}';`,
    `export * from '${sdkName}';`,
    `const sdk = require('${sdkName}');`,
    `import sdk = require('${sdkName}');`,
    `const sdk = import('${sdkName}');`,
  ])
    assert.notDeepEqual(sdkValueImports(source, "query.ts"), [], source);
});

test("AST permits pure types and only one literal dynamic SDK import at its owner", () => {
  const types = `import type * as SDK from '${sdkName}';
    import { type Query } from '${sdkName}';
    export type { Query } from '${sdkName}';
    export { type Query } from '${sdkName}';
    type SDK = typeof import('${sdkName}');
    // import { query } from '${sdkName}';
  `;
  assert.deepEqual(sdkValueImports(types, "query.ts"), []);
  const allowed = `const sdk = import('${sdkName}');`;
  assert.deepEqual(sdkValueImports(allowed, runtimePath), []);
  assert.notDeepEqual(sdkValueImports(allowed + allowed, runtimePath), []);
  for (const source of [
    `const name = '${sdkName}'; import(name);`,
    `import('@anthropic-ai/' + 'claude-agent-sdk');`,
    `import(\`${sdkName}\`);`,
    `import('${sdkName}/sdk.mjs');`,
  ])
    assert.notDeepEqual(sdkValueImports(source, runtimePath), [], source);
});

test("shipped sources have no SDK values except the loader's literal dynamic import", () => {
  const hits = [];
  const directories = readdirSync(path.join(repoRoot, "packages")).map((name) =>
    path.join(repoRoot, "packages", name, "src"),
  );
  directories.push(path.join(repoRoot, "packages/server/scripts"));
  for (const src of directories) {
    if (!existsSync(src)) continue;
    for (const file of shippedSourceFiles(src, /\.[cm]?[jt]sx?$/)) {
      const relative = path.relative(repoRoot, file).split(path.sep).join("/");
      const source = readFileSync(file, "utf8");
      for (const hit of sdkValueImports(source, relative)) hits.push(`${relative}: ${hit}`);
    }
  }
  assert.deepEqual(hits, []);
});

test("electron-builder's production collector includes undici and excludes the proprietary SDK", async () => {
  // Pure dependency collection only: no app build, package manager command or asar creation.
  const { TraversalNodeModulesCollector } =
    await import("app-builder-lib/out/node-module-collector/traversalNodeModulesCollector.js");
  const collector = new TraversalNodeModulesCollector(path.join(repoRoot, "packages/desktop"), {
    getTempFile() {
      throw new Error("Dependency check must not invoke a package manager");
    },
  });
  const { nodeModules } = await collector.getNodeModules({ packageName: "@getpaseo/desktop" });
  const entries = [];
  function walk(nodes) {
    for (const entry of nodes) {
      entries.push(entry);
      walk(entry.dependencies ?? []);
    }
  }
  walk(nodeModules);
  assert.equal(
    entries.some((entry) => entry.name === sdkName),
    false,
  );
  assert.ok(entries.some((entry) => entry.name === "undici" && entry.version === "7.24.8"));
  assert.ok(entries.some((entry) => entry.name === "@getpaseo/server"));
});
