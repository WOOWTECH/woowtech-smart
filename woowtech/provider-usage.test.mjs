// Account usage (plan quota) stays off in the daemon: it never reads provider credentials
// for it. The App side is in provider-usage-app.test.mjs. README section 23.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { test } from "node:test";
import { importSource } from "./source-modules.mjs";

function serverSource(file) {
  return readFileSync(new URL(`../packages/server/src/${file}`, import.meta.url), "utf8");
}

const { isProviderUsageFetchingEnabled } = await importSource(
  "packages/server/src/server/woowtech-provider-usage-policy.ts",
);

test("account usage is off in the fork policy, not a user setting", () => {
  assert.equal(isProviderUsageFetchingEnabled(), false);
  assert.doesNotMatch(
    serverSource("server/woowtech-provider-usage-policy.ts"),
    /process\.env|readFile|import\s/,
  );
});

test("the usage service reaches the policy before it creates or calls a fetcher", () => {
  const service = serverSource("services/quota-fetcher/service.ts");
  assert.match(service, /from "\.\.\/\.\.\/server\/woowtech-provider-usage-policy\.js"/);
  assert.match(
    service,
    /this\.isUsageFetchingEnabled = options\.isUsageFetchingEnabled \?\? isProviderUsageFetchingEnabled;/,
  );
  assert.match(
    service,
    /this\.fetchers = this\.isUsageFetchingEnabled\(\)\s*\?\s*\(options\.fetchers \?\?\s*createProviderUsageFetchers\(/,
  );
  const listUsage = service.slice(
    service.indexOf("  async listUsage("),
    service.indexOf("  private async fetchFreshUsage("),
  );
  assert.match(
    listUsage,
    /^ {2}async listUsage\([^)]*\): Promise<ProviderUsageListResult> \{\s*(?:\/\/[^\n]*\n\s*)*if \(!this\.isUsageFetchingEnabled\(\)\) \{\s*return \{ fetchedAt: new Date\(this\.now\(\)\)\.toISOString\(\), providers: \[\] \};\s*\}/,
  );
});

test("the daemon builds its usage service without a policy, fetcher or fetch override", () => {
  const server = serverSource("server/websocket-server.ts");
  assert.match(
    server,
    /this\.providerUsageService = new ProviderUsageService\(\{\s*logger: this\.logger,\s*\}\);/,
  );
});

test("the OFF baseline and positive control live in the fork-owned suite", () => {
  const upstream = serverSource("services/quota-fetcher/service.test.ts");
  const fork = serverSource("services/quota-fetcher/woowtech-provider-usage.test.ts");
  assert.match(fork, /woowtech OFF baseline/);
  assert.match(fork, /explicit upstream test policy/);
  assert.match(fork, /per-session token and context counts stay on/);
  assert.doesNotMatch(upstream, /woowtech OFF baseline/);
  // Every upstream service test runs with usage on, so none of them exercises the OFF
  // path by accident and the upstream assertions stay unchanged.
  const services = upstream.match(/new ProviderUsageService\(/g) ?? [];
  const onPolicies = upstream.match(/isUsageFetchingEnabled: \(\) => true/g) ?? [];
  assert.ok(services.length > 0);
  assert.equal(onPolicies.length, services.length);
});

const QUOTA = "services/quota-fetcher/";
const FETCHER_NAMES = new Set([
  "ClaudeQuotaProvider",
  "CodexQuotaProvider",
  "CopilotQuotaProvider",
  "CursorQuotaProvider",
  "GrokQuotaProvider",
  "KimiQuotaProvider",
  "MiniMaxQuotaProvider",
  "ZaiQuotaProvider",
  "readClaudeKeychainCredentials",
]);

// Who may touch what in the server's shipped sources. Everything else reaching these
// names or modules could read a provider's credentials outside the fork policy.
function accessRule(name) {
  if (name === "ProviderUsageService") {
    return (file) => file === "server/websocket-server.ts" || file === `${QUOTA}service.ts`;
  }
  if (name === "createProviderUsageFetchers" || name === "PROVIDER_USAGE_FETCHERS") {
    return (file) => file === `${QUOTA}service.ts` || file === `${QUOTA}manifest.ts`;
  }
  if (FETCHER_NAMES.has(name)) {
    return (file) => file === `${QUOTA}manifest.ts` || file.startsWith(`${QUOTA}providers/`);
  }
  return null;
}

function moduleRule(target) {
  if (target === `${QUOTA}manifest`) return (file) => file === `${QUOTA}service.ts`;
  if (target.startsWith(`${QUOTA}providers/`)) return (file) => file === `${QUOTA}manifest.ts`;
  return null;
}

// A string that names a module at runtime: import/export from, import() and require().
function isModuleSpecifier(node) {
  const parent = node.parent;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) {
    return parent.moduleSpecifier === node;
  }
  if (ts.isExternalModuleReference(parent)) return true;
  if (!ts.isCallExpression(parent) || parent.arguments[0] !== node) return false;
  const callee = parent.expression;
  return (
    callee.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(callee) && callee.text === "require")
  );
}

function resolveModule(file, specifier) {
  if (!specifier.startsWith(".")) return null;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
  return resolved.replace(/\.[cm]?[jt]sx?$/, "");
}

function isTypeOnlyUse(node) {
  const parent = node.parent;
  if (ts.isTypeReferenceNode(parent) || ts.isTypeQueryNode(parent)) return true;
  if (ts.isQualifiedName(parent)) return true;
  if (ts.isClassDeclaration(parent) && parent.name === node) return true;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) {
    // The import clause or export declaration that holds the specifier.
    return parent.isTypeOnly || parent.parent.parent.isTypeOnly === true;
  }
  if (ts.isExpressionWithTypeArguments(parent)) {
    const clause = parent.parent;
    return ts.isHeritageClause(clause) && clause.token === ts.SyntaxKind.ImplementsKeyword;
  }
  return false;
}

function findUsageAccesses(files) {
  const accesses = [];
  for (const [file, text] of files) {
    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)) continue;
    if (/(?:^|\/)(?:__tests__|test-utils|fixtures)\//.test(file)) continue;
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    function report(node) {
      const { line } = tree.getLineAndCharacterOfPosition(node.getStart(tree));
      accesses.push(`${file}:${line + 1}`);
    }
    function visit(node) {
      if (ts.isIdentifier(node)) {
        const allowed = accessRule(node.text);
        if (allowed && !allowed(file) && !isTypeOnlyUse(node)) report(node);
      } else if (ts.isStringLiteral(node)) {
        const target = isModuleSpecifier(node) ? resolveModule(file, node.text) : null;
        const allowedImporter = target ? moduleRule(target) : null;
        if (allowedImporter && !allowedImporter(file)) report(node);
        const allowedName = accessRule(node.text);
        if (
          allowedName &&
          !allowedName(file) &&
          ts.isElementAccessExpression(node.parent) &&
          node.parent.argumentExpression === node
        ) {
          report(node);
        }
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

test("only the gated service creates quota fetchers and only the daemon builds the service", () => {
  assert.deepEqual(findUsageAccesses(productionSources()), []);
});

test("no shipped server source passes the usage policy override", () => {
  const hits = productionSources()
    .filter(([file]) => !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file))
    .filter(([file]) => !/(?:^|\/)(?:__tests__|test-utils|fixtures)\//.test(file))
    .filter(([file]) => file !== `${QUOTA}service.ts`)
    .flatMap(([file, text]) =>
      text
        .split("\n")
        .map((line, index) => [line, index])
        .filter(([line]) => /isUsageFetchingEnabled/.test(line))
        .map(([, index]) => `${file}:${index + 1}`),
    );
  assert.deepEqual(hits, []);
});

test("usage scan rejects aliases, namespaces, re-exports, dynamic imports and new callers", () => {
  for (const [file, text] of [
    [
      "server/unexpected.ts",
      'import { ProviderUsageService as Usage } from "../services/quota-fetcher/service.js"; new Usage({ logger });',
    ],
    [
      "server/unexpected.ts",
      'import * as usage from "../services/quota-fetcher/service.js"; new usage["ProviderUsageService"]({ logger });',
    ],
    [
      "server/unexpected.ts",
      'import { createProviderUsageFetchers } from "../services/quota-fetcher/manifest.js";',
    ],
    ["server/unexpected.ts", 'export * from "../services/quota-fetcher/manifest.js";'],
    [
      "server/unexpected.ts",
      'const claude = await import("../services/quota-fetcher/providers/claude.js");',
    ],
    ["server/unexpected.ts", "new ClaudeQuotaProvider({ logger });"],
    ["server/unexpected.ts", "await readClaudeKeychainCredentials();"],
    [`${QUOTA}usage.ts`, 'import { ZaiQuotaProvider } from "./providers/zai.js";'],
    ["server/unexpected.ts", "class Quiet extends ProviderUsageService {}"],
  ]) {
    assert.ok(findUsageAccesses([[file, text]]).length > 0, text);
  }
});

test("usage scan allows type-only uses, declarations, the owners and tests", () => {
  assert.deepEqual(
    findUsageAccesses([
      [
        "server/session.ts",
        'import type { ProviderUsageService } from "../services/quota-fetcher/service.js"; let s: ProviderUsageService; type T = typeof ProviderUsageService;',
      ],
      [
        "server/websocket-server.ts",
        'import { ProviderUsageService } from "../services/quota-fetcher/service.js"; new ProviderUsageService({ logger });',
      ],
      [
        `${QUOTA}service.ts`,
        'import { createProviderUsageFetchers } from "./manifest.js"; export class ProviderUsageService {}',
      ],
      [
        `${QUOTA}manifest.ts`,
        'import { ClaudeQuotaProvider } from "./providers/claude.js"; new ClaudeQuotaProvider({ logger });',
      ],
      [
        `${QUOTA}providers/claude.ts`,
        'export class ClaudeQuotaProvider {} const home = join(homedir(), ".claude", "../manifest");',
      ],
      [`${QUOTA}woowtech-provider-usage.test.ts`, "new ClaudeQuotaProvider({ logger });"],
      ["server/test-utils/usage.ts", "new ProviderUsageService({ logger });"],
    ]),
    [],
  );
});
