// Account usage (plan quota) stays hidden in the App: no usage page, no usage block in the
// context meter tooltip, and no usage request to a host. The daemon side is in
// provider-usage.test.mjs. README section 23.
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
