// Account usage (plan quota) stays hidden in the App: no usage page, no usage block in the
// context meter tooltip, no usage request to a host, and no e2e that still opens the usage
// page. The daemon side is in provider-usage.test.mjs. README section 23.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import { test } from "node:test";
import { requireSource } from "./source-modules.mjs";

function isTypeOnlyUse(node) {
  const parent = node.parent;
  if (ts.isTypeReferenceNode(parent) || ts.isTypeQueryNode(parent)) return true;
  if (ts.isQualifiedName(parent)) return true;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) {
    // The import clause or export declaration that holds the specifier.
    return parent.isTypeOnly || parent.parent.parent.isTypeOnly === true;
  }
  return false;
}

function appSource(file) {
  return readFileSync(new URL(`../packages/app/src/${file}`, import.meta.url), "utf8");
}

test("the App keeps account usage hidden, not as a user setting", () => {
  const { PROVIDER_USAGE_VISIBLE } = requireSource(
    "packages/app/src/provider-usage/woowtech-usage-visibility.ts",
  );
  assert.equal(PROVIDER_USAGE_VISIBLE, false);
  assert.doesNotMatch(
    appSource("provider-usage/woowtech-usage-visibility.ts"),
    /process\.env|useSettings|AsyncStorage|import (?!type )/,
  );
});

test("the host settings list and the host section route leave the usage page out", () => {
  const settings = appSource("screens/settings-screen.tsx");
  assert.match(settings, /from "@\/provider-usage\/woowtech-usage-visibility"/);
  assert.match(settings, /const HOST_SECTION_ITEMS: HostSectionItem\[\] = visibleHostSections\(\[/);
  const route = appSource("app/settings/hosts/[serverId]/[hostSection].tsx");
  assert.match(
    route,
    /const section = visibleHostSection\(normalizeHostSectionSlug\(rawSection\)\) \?\? "connections";/,
  );
});

test("the context meter tooltip never asks for usage or shows it while usage is hidden", () => {
  const meter = appSource("components/context-window-meter.tsx");
  assert.match(meter, /from "@\/provider-usage\/woowtech-usage-visibility"/);
  assert.match(meter, /\{ enabled: PROVIDER_USAGE_VISIBLE && isTooltipOpen \}/);
  assert.match(
    meter,
    /if \(nextOpen && PROVIDER_USAGE_VISIBLE\) \{\s*void refreshProviderUsage\(\)/,
  );
  assert.equal(meter.match(/refreshProviderUsage\(\)/g)?.length, 1);
  assert.match(meter, /\{PROVIDER_USAGE_VISIBLE \? \(\s*<ProviderUsageTooltipSection /);
  assert.equal(meter.match(/<ProviderUsageTooltipSection /g)?.length, 1);
});

const APP_OWNERS = {
  useProviderUsage: [
    "provider-usage/use-provider-usage.ts",
    "screens/settings/host-page.tsx",
    "components/context-window-meter.tsx",
  ],
  listProviderUsage: ["provider-usage/use-provider-usage.ts"],
  ProviderUsageSettingsSection: [
    "provider-usage/settings-section.tsx",
    "screens/settings/host-page.tsx",
  ],
  ProviderUsageTooltipSection: [
    "provider-usage/tooltip-section.tsx",
    "components/context-window-meter.tsx",
  ],
  HostUsagePage: ["screens/settings/host-page.tsx", "screens/settings-screen.tsx"],
};

// Every shipped App file that reaches a usage entry point, other than the owners above.
// A new upstream entry point, such as a usage link elsewhere, turns this red.
function findAppUsageAccesses(files) {
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
      const owners =
        ts.isIdentifier(node) && Object.hasOwn(APP_OWNERS, node.text)
          ? APP_OWNERS[node.text]
          : null;
      if (owners && !owners.includes(file) && !isTypeOnlyUse(node)) report(node);
      if (ts.isStringLiteral(node) && node.text === "provider.usage.list.request") report(node);
      if (
        ts.isPropertyAssignment(node) &&
        node.name.getText(tree) === "section" &&
        ts.isStringLiteral(node.initializer) &&
        node.initializer.text === "usage"
      ) {
        report(node);
      }
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(tree) === "buildSettingsHostSectionRoute" &&
        node.arguments.some((argument) => ts.isStringLiteral(argument) && argument.text === "usage")
      ) {
        report(node);
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
  return accesses;
}

function appProductionSources(
  directory = new URL("../packages/app/src/", import.meta.url),
  prefix = "",
) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = `${prefix}${entry.name}`;
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) return appProductionSources(url, `${file}/`);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [[file, readFileSync(url, "utf8")]] : [];
  });
}

test("no other shipped App file opens the usage page or asks the host for usage", () => {
  assert.deepEqual(findAppUsageAccesses(appProductionSources()), []);
});

test("App usage scan rejects new entry points and allows the owners and tests", () => {
  for (const text of [
    'import { useProviderUsage as useUsage } from "@/provider-usage/use-provider-usage"; useUsage(id);',
    "<ProviderUsageTooltipSection view={view} activeProviderId={id} />",
    "<ProviderUsageSettingsSection view={view} onRefresh={refresh} />",
    "<HostUsagePage serverId={id} />",
    "client.listProviderUsage();",
    'client.send({ type: "provider.usage.list.request", requestId });',
    'router.push({ kind: "host", serverId, section: "usage" });',
    'router.push(buildSettingsHostSectionRoute(serverId, "usage"));',
  ]) {
    assert.ok(findAppUsageAccesses([["screens/unexpected.tsx", text]]).length > 0, text);
  }
  assert.deepEqual(
    findAppUsageAccesses([
      ["components/context-window-meter.tsx", "<ProviderUsageTooltipSection view={view} />"],
      ["screens/settings-screen.tsx", "<HostUsagePage serverId={id} />"],
      ["provider-usage/use-provider-usage.ts", "client.listProviderUsage();"],
      [
        "screens/unexpected.tsx",
        'import type { useProviderUsage } from "x"; type T = typeof useProviderUsage;',
      ],
      ["components/woowtech-context-window-meter.test.tsx", "client.listProviderUsage();"],
    ]),
    [],
  );
});

// The e2e side. Settings has no Usage row and the usage route opens Connections, so an e2e
// that still opens the usage page waits for a row that never shows. The desktop browser E2E's
// Settings rotation did, and CI #10 and #11 timed out on it.
const REPO_ROOT = new URL("../", import.meta.url);
const E2E_ROOTS = ["packages/app/e2e/", "packages/desktop/e2e/"];
// Fork specs that open the old usage route on purpose, to check that it lands on Connections.
const USAGE_ROUTE_FALLBACK_CHECKS = new Set([
  "packages/app/e2e/browser/woowtech-provider-usage-hidden.spec.ts",
]);
const USAGE_ROW_TEST_ID = "settings-host-section-usage";
const USAGE_ROUTE = /\/settings\/hosts\/[^/]+\/usage(?:[/?#]|$)/;
const HOST_SECTION_HELPERS = new Set(["openSettingsHostSection", "buildSettingsHostSectionRoute"]);
// agent-device flows are plain text: the row's test id, its quoted label, or the route.
const FLOW_USAGE_REFERENCE =
  /settings-host-section-usage|\\?"Usage\\?"|\/settings\/hosts\/[^/\s"]+\/usage(?![\w-])/;

// A string or template's text; a template's placeholders read as "${}".
function literalText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return null;
  return node.head.text + node.templateSpans.map((span) => `\${}${span.literal.text}`).join("");
}

function calleeName(call) {
  if (ts.isIdentifier(call.expression)) return call.expression.text;
  if (ts.isPropertyAccessExpression(call.expression)) return call.expression.name.text;
  return null;
}

function opensUsageSection(node, tree) {
  const text = literalText(node);
  if (text !== null) {
    return text === "Usage" || text.includes(USAGE_ROW_TEST_ID) || USAGE_ROUTE.test(text);
  }
  if (ts.isCallExpression(node) && HOST_SECTION_HELPERS.has(calleeName(node))) {
    return node.arguments.some(
      (argument) => ts.isStringLiteral(argument) && argument.text === "usage",
    );
  }
  return (
    ts.isPropertyAssignment(node) &&
    node.name.getText(tree) === "section" &&
    ts.isStringLiteral(node.initializer) &&
    node.initializer.text === "usage"
  );
}

// Inside the callback of test.skip, test.describe.skip or describe.skip: upstream's usage specs.
function isInSkippedCallback(node) {
  for (let child = node; child.parent; child = child.parent) {
    const call = child.parent;
    if (
      ts.isCallExpression(call) &&
      ts.isFunctionLike(child) &&
      call.arguments.includes(child) &&
      ts.isPropertyAccessExpression(call.expression) &&
      call.expression.name.text === "skip"
    ) {
      return true;
    }
  }
  return false;
}

// expect(...).toHaveCount(0), .toBeHidden(), .not.toBeVisible() or .not.toBeAttached().
function assertsAbsence(expectCall) {
  let matcher = expectCall.parent;
  if (!ts.isPropertyAccessExpression(matcher)) return false;
  const negated = matcher.name.text === "not";
  if (negated) matcher = matcher.parent;
  if (!ts.isPropertyAccessExpression(matcher) || !ts.isCallExpression(matcher.parent)) return false;
  const [expected] = matcher.parent.arguments;
  switch (matcher.name.text) {
    case "toHaveCount":
      return (
        !negated && expected !== undefined && ts.isNumericLiteral(expected) && expected.text === "0"
      );
    case "toBeHidden":
      return !negated;
    case "toBeVisible":
    case "toBeAttached":
      return negated;
    default:
      return false;
  }
}

function isInAbsenceAssertion(node) {
  for (let child = node; child.parent; child = child.parent) {
    const call = child.parent;
    if (
      ts.isCallExpression(call) &&
      ts.isIdentifier(call.expression) &&
      call.expression.text === "expect" &&
      call.arguments.includes(child)
    ) {
      return assertsAbsence(call);
    }
  }
  return false;
}

function isAllowedUsageReference(node, file) {
  if (isInSkippedCallback(node) || isInAbsenceAssertion(node)) return true;
  return USAGE_ROUTE_FALLBACK_CHECKS.has(file) && USAGE_ROUTE.test(literalText(node) ?? "");
}

// Every e2e line that opens the usage page: its sidebar row (label or test id), the host
// section helpers with "usage", a section: "usage" route, or a /settings/hosts/<id>/usage path.
function findE2eUsageSectionReferences(files) {
  const references = [];
  for (const [file, text] of files) {
    if (file.endsWith(".ad")) {
      for (const [index, flowLine] of text.split("\n").entries()) {
        if (FLOW_USAGE_REFERENCE.test(flowLine)) references.push(`${file}:${index + 1}`);
      }
      continue;
    }
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (opensUsageSection(node, tree) && !isAllowedUsageReference(node, file)) {
        const { line } = tree.getLineAndCharacterOfPosition(node.getStart(tree));
        references.push(`${file}:${line + 1}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
  return references;
}

function e2eSources(directories = E2E_ROOTS) {
  return directories.flatMap((directory) =>
    readdirSync(new URL(directory, REPO_ROOT), { withFileTypes: true }).flatMap((entry) => {
      const file = `${directory}${entry.name}`;
      if (entry.isDirectory()) return entry.name === "node_modules" ? [] : e2eSources([`${file}/`]);
      if (!/\.(?:[cm]?[jt]sx?|ad)$/.test(entry.name)) return [];
      return [[file, readFileSync(new URL(file, REPO_ROOT), "utf8")]];
    }),
  );
}

test("no app or desktop e2e opens the hidden usage page", () => {
  const references = findE2eUsageSectionReferences(e2eSources());
  assert.deepEqual(
    references,
    [],
    "Account usage is hidden (woowtech/README.md section 23): Settings has no Usage row and " +
      "the usage route opens Connections. These e2e lines still open the usage page:\n" +
      references.join("\n"),
  );
});

test("e2e usage scan rejects each way into the usage page and allows skips and absence checks", () => {
  for (const text of [
    'const DESTINATIONS = ["Providers", "Usage", "Terminals"];',
    'await sidebar.getByRole("button", { name: "Usage", exact: true }).click();',
    'await page.getByTestId("settings-host-section-usage").click();',
    'await expect(page.getByTestId("settings-host-section-usage")).toBeVisible();',
    'await expect(page.getByTestId("settings-host-section-usage")).not.toHaveCount(0);',
    'await openSettingsHostSection(page, serverId, "usage");',
    'await page.goto(buildSettingsHostSectionRoute(serverId, "usage"));',
    `await page.goto(\`/settings/hosts/\${encodeURIComponent(serverId)}/usage\`);`,
    'await page.goto("/settings/hosts/srv_1/usage?refresh=1");',
    'router.push({ kind: "host", serverId, section: "usage" });',
    'test.skip(isMobile); await openSettingsHostSection(page, serverId, "usage");',
  ]) {
    assert.ok(findE2eUsageSectionReferences([["e2e/unexpected.spec.ts", text]]).length > 0, text);
  }
  for (const text of ['press "id=\\"settings-host-section-usage\\""', 'press "Usage"']) {
    assert.ok(findE2eUsageSectionReferences([["e2e/unexpected.ad", text]]).length > 0, text);
  }
  // The route check's own file may open the route, not the row.
  assert.equal(
    findE2eUsageSectionReferences([
      [
        [...USAGE_ROUTE_FALLBACK_CHECKS][0],
        'await page.getByTestId("settings-host-section-usage").click();',
      ],
    ]).length,
    1,
  );
  assert.deepEqual(
    findE2eUsageSectionReferences([
      [
        "e2e/skipped.spec.ts",
        'test.describe.skip("usage", () => { test("opens it", async ({ page }) => { ' +
          'await openSettingsHostSection(page, id, "usage"); }); });',
      ],
      [
        "e2e/absent.spec.ts",
        'await expect(sidebar.getByTestId("settings-host-section-usage")).toHaveCount(0);',
      ],
      [
        "e2e/hidden.spec.ts",
        'await expect(sidebar.getByRole("button", { name: "Usage" })).not.toBeVisible();',
      ],
      ["e2e/helpers.ts", 'type HostSection = "providers" | "usage" | "terminals";'],
      ["e2e/smoke.js", 'process.stderr.write("Usage: node smoke.js --app <app>");'],
      ["e2e/plugin-buttons.ts", 'pill("usage", { title: "Composer status" });'],
      [
        [...USAGE_ROUTE_FALLBACK_CHECKS][0],
        `await page.goto(\`/settings/hosts/\${encodeURIComponent(serverId)}/usage\`);`,
      ],
      ["e2e/flow.ad", 'press "id=\\"settings-host-section-providers\\""'],
    ]),
    [],
  );
});
