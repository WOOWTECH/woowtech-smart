// woowtech smart's pairing links and QR codes open the app itself, not upstream's
// hosted web app (owner decision 直接叫起 App; woowtech/README.md, 第 19 節). A link is
// the app's root URL with the offer in its fragment: woowtech-smart:///#offer=<payload>.
// A merge can bring upstream's web app back into the daemon's defaults
// (persisted-config.ts, config.ts, pairing-offer.ts, bootstrap.ts), the CLI's onboarding
// or the app's paste-a-link field, or drop the rule that moves existing homes off
// upstream's default. These checks run the daemon's config and pairing code from source
// through tsx, ask expo-router and Expo's app config how the app takes the link, and scan
// the shipped sources. The daemon's imports from other packages read their dist (the
// link's base comes from @getpaseo/protocol), so build them first: npm run build:server.
//
//   node --test woowtech/pairing.test.mjs
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { expoIntrospectedConfig } from "./expo-config.mjs";
import { findInShippedSources, repoRoot } from "./shipped-sources.mjs";
import { importSource } from "./source-modules.mjs";

const { loadConfig } = await importSource("packages/server/src/server/config.ts");
const { readPersistedConfig } = await importSource(
  "packages/server/src/server/persisted-config.ts",
);
const { generateLocalPairingOffer } = await importSource(
  "packages/server/src/server/pairing-offer.ts",
);
const { getOrCreateServerId } = await importSource("packages/server/src/server/server-id.ts");
const { parseConnectionOfferFromUrl } = await importSource(
  "packages/protocol/src/connection-offer.ts",
);

const APP_SCHEME = "woowtech-smart";
const APP_LINK_PREFIX = `${APP_SCHEME}:///#offer=`;
const UPSTREAM_WEB_APP = /app\.paseo\.sh/;
// The one shipped file that names upstream's web app: it moves homes off its default.
const MIGRATION_SOURCE = "packages/server/src/server/app-base-url.ts";

const homes = [];
after(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

/** A daemon home with `config` as its config.json, or with no config.json at all. */
function daemonHome(config) {
  const home = mkdtempSync(path.join(tmpdir(), "woowtech-pairing-"));
  homes.push(home);
  if (config !== undefined) {
    writeFileSync(path.join(home, "config.json"), JSON.stringify(config));
  }
  return home;
}

/** The `android:name` of each manifest element, such as an intent filter's actions. */
function androidNames(elements) {
  return (elements ?? []).map((element) => element.$["android:name"]);
}

/** The intent filters of the app's Android activities, as prebuild writes the manifest. */
function androidIntentFilters(introspectedConfig) {
  const { manifest } = introspectedConfig._internal.modResults.android.manifest;
  const filters = [];
  for (const activity of manifest.application[0].activity ?? []) {
    for (const filter of activity["intent-filter"] ?? []) {
      filters.push({
        actions: androidNames(filter.action),
        categories: androidNames(filter.category),
        data: (filter.data ?? []).map((data) => data.$),
      });
    }
  }
  return filters;
}

/** The pairing link the daemon in `home` hands out, ignoring this shell's PASEO_* variables. */
async function pairingLinkOf(home) {
  const config = loadConfig(home, { env: {} });
  const pairing = await generateLocalPairingOffer({
    paseoHome: home,
    relayEnabled: true,
    relayEndpoint: config.relayEndpoint,
    relayPublicEndpoint: config.relayPublicEndpoint,
    relayUseTls: config.relayUseTls,
    relayPublicUseTls: config.relayPublicUseTls,
    appBaseUrl: config.appBaseUrl,
    includeQr: false,
  });
  return pairing.url;
}

test("pairing links from a new home open the app at its root with the offer", async () => {
  const home = daemonHome();
  const link = await pairingLinkOf(home);

  assert.ok(link.startsWith(APP_LINK_PREFIX), `the daemon hands out ${link}`);
  assert.equal(parseConnectionOfferFromUrl(link).serverId, getOrCreateServerId(home, { env: {} }));
  const offerless = await generateLocalPairingOffer({ paseoHome: home, includeQr: false });
  assert.ok(offerless.url.startsWith(APP_LINK_PREFIX), `without app.baseUrl: ${offerless.url}`);
});

test("the app registers the link's scheme and routes the link to its start screen", async () => {
  // Expo Router turns a custom-scheme link into a route from its host and path and
  // leaves the fragment to OfferLinkListener. An empty path is the index route
  // (src/app/index.tsx), which exists before the app's stores are ready.
  const appRequire = createRequire(path.join(repoRoot, "packages/app/package.json"));
  const { extractExpoPathFromURL } = appRequire("expo-router/build/fork/extractPathFromURL");
  const link = await pairingLinkOf(daemonHome());
  assert.equal(extractExpoPathFromURL([], link), "", `Expo Router routes ${link} elsewhere`);
  assert.ok(existsSync(path.join(repoRoot, "packages/app/src/app/index.tsx")));

  for (const variant of ["production", "development"]) {
    const config = expoIntrospectedConfig(variant);
    assert.equal(config.scheme, APP_SCHEME, `${variant}: app.config.js scheme`);

    const iosSchemes = (config.ios.infoPlist.CFBundleURLTypes ?? []).flatMap(
      (type) => type.CFBundleURLSchemes ?? [],
    );
    assert.ok(iosSchemes.includes(APP_SCHEME), `${variant}: iOS does not register ${APP_SCHEME}`);

    // Android opens the link only through a VIEW + BROWSABLE filter for the scheme.
    // A host or path in the same filter would narrow every scheme it lists.
    const linkFilters = androidIntentFilters(config).filter(
      (filter) =>
        filter.actions.includes("android.intent.action.VIEW") &&
        filter.categories.includes("android.intent.category.BROWSABLE") &&
        filter.data.some((data) => data["android:scheme"] === APP_SCHEME),
    );
    assert.equal(linkFilters.length, 1, `${variant}: Android filters for ${APP_SCHEME}`);
    const narrowing = linkFilters[0].data.flatMap((data) =>
      Object.keys(data).filter((key) => key !== "android:scheme"),
    );
    assert.deepEqual(narrowing, [], `${variant}: Android narrows ${APP_SCHEME} links`);
  }
});

// The app hands each link it is opened with to handlePairingLink (runtime/woowtech-pairing-link.ts,
// which its unit tests cover). Upstream's own pairing links only ever reach its web app, so a merge
// that limits OfferLinkListener to the web, or makes it parse links with the URL class, would stop
// pairing through the phone's camera without failing anything else.
test("the app hands every link it is opened with to handlePairingLink, on every platform", () => {
  const layoutPath = "packages/app/src/app/_layout.tsx";
  const layout = readFileSync(path.join(repoRoot, layoutPath), "utf8");

  const mounts = layout.split("\n").filter((line) => line.includes("<OfferLinkListener"));
  assert.equal(mounts.length, 1, `${layoutPath} mounts OfferLinkListener ${mounts.length} times`);
  assert.match(
    mounts[0],
    /^\s*<OfferLinkListener\b[^{}]*=\{\w+\}\s*\/>$/,
    `OfferLinkListener is mounted under a condition: ${mounts[0].trim()}`,
  );

  const listener = /^function OfferLinkListener\([\s\S]*?^\}$/m.exec(layout)?.[0];
  assert.ok(listener, `OfferLinkListener is gone from ${layoutPath}`);
  for (const call of [
    "Linking.getInitialURL()",
    'Linking.addEventListener("url"',
    "handlePairingLink(",
  ]) {
    assert.ok(listener.includes(call), `OfferLinkListener no longer calls ${call}`);
  }
  assert.doesNotMatch(
    listener,
    /Platform\.|isWeb|isNative|getIsElectron|new URL\(/,
    "OfferLinkListener depends on the platform or reads links with the URL class",
  );
  assert.ok(
    layout.includes('import { handlePairingLink } from "@/runtime/woowtech-pairing-link";'),
    `${layoutPath} does not import handlePairingLink`,
  );
});

test("homes created with upstream's default app.baseUrl get the app link; other values stay", async () => {
  for (const upstreamDefault of ["https://app.paseo.sh", "https://app.paseo.sh/"]) {
    const link = await pairingLinkOf(daemonHome({ version: 1, app: { baseUrl: upstreamDefault } }));
    assert.ok(link.startsWith(APP_LINK_PREFIX), `${upstreamDefault} still hands out ${link}`);
  }
  const chosen = "https://pair.example.test";
  const link = await pairingLinkOf(daemonHome({ version: 1, app: { baseUrl: chosen } }));
  assert.ok(link.startsWith(`${chosen}/#offer=`), `a chosen app.baseUrl became ${link}`);
});

test("a new home lets no web app origin in", () => {
  const home = daemonHome();
  assert.deepEqual(loadConfig(home, { env: {} }).corsAllowedOrigins, []);
  const written = readFileSync(path.join(home, "config.json"), "utf8");
  assert.doesNotMatch(written, UPSTREAM_WEB_APP, "the config.json a new home gets");
  // The CLI reads the defaults without creating the home (daemon pair, onboard).
  const cliDefaults = readPersistedConfig(daemonHome(), { defaultsIfMissing: true });
  assert.doesNotMatch(JSON.stringify(cliDefaults), UPSTREAM_WEB_APP, "the CLI's defaults");
});

// Shipped: the source folders of every package that goes into the phone app, the
// desktop app, the daemon, the CLI and the relay Worker (shipped-sources.mjs, plus the
// relay, plugin, highlight and expo-two-way-audio packages the app and the daemon depend
// on), the agent skills the daemon installs, and the app's config (app.config.js,
// eas.json, plugins/, public/). The app's translations are part of packages/app/src
// (src/i18n). Left out, as not shipped: tests, e2e suites and test utilities, docs/,
// public-docs/, SECURITY.md, CHANGELOG.md and other Markdown, scripts/, nix/,
// packages/website (upstream's website) and woowtech/ apart from its skills.
test("no shipped source names upstream's web app", () => {
  const hits = [
    ...findInShippedSources([UPSTREAM_WEB_APP], {
      files: [
        "packages/app/app.config.js",
        "packages/app/eas.json",
        "packages/app/public/index.html",
        "packages/app/public/manifest.json",
        "packages/desktop/electron-builder.yml",
        "packages/relay/wrangler.woowtech.toml",
      ],
      skipPaths: [MIGRATION_SOURCE],
    }),
    ...findInShippedSources([UPSTREAM_WEB_APP], {
      dirs: [
        "packages/relay/src",
        "packages/plugin/src",
        "packages/highlight/src",
        "packages/expo-two-way-audio/src",
        "packages/app/plugins",
        "woowtech/skills",
      ],
      fileTypes: /\.(?:[cm]?[jt]sx?|json|md)$/,
    }),
  ];
  assert.deepEqual(hits, []);

  const namedInMigration = readFileSync(path.join(repoRoot, MIGRATION_SOURCE), "utf8")
    .split("\n")
    .filter((line) => UPSTREAM_WEB_APP.test(line));
  assert.deepEqual(namedInMigration, [
    'const UPSTREAM_DEFAULT_APP_BASE_URL = "https://app.paseo.sh";',
  ]);
});

test("host labels use normal server_info with hydration and generation guards", () => {
  const runtime = readFileSync(
    path.join(repoRoot, "packages/app/src/runtime/host-runtime.ts"),
    "utf8",
  );
  assert.match(runtime, /onServerInfo: \(info\) => this.fillHostLabel\(controller, info\)/);
  assert.match(runtime, /const unobserve = observeHostLabelServerInfo\(\{/);
  assert.match(
    runtime,
    /isCurrent: \(\) =>\s*this.isCurrentSwitchRequest\(requestVersion\) && this.activeClient === client/,
  );
  assert.match(
    runtime,
    /this.unsubscribeClientHandlers = \(\) => \{\s*unobserve\(\);\s*unmount\?\.\(\);/,
  );
  assert.match(
    runtime,
    /this.hostRegistryLoaded = true;\s*for \(const controller of this.controllers.values\(\)\) \{\s*this.fillHostLabel\(controller, controller.getClient\(\)\?\.getLastServerInfoMessage\(\) \?\? null\)/,
  );
  const fill = runtime.slice(
    runtime.indexOf("  private fillHostLabel("),
    runtime.indexOf("  private async persistHosts("),
  );
  assert.match(fill, /!this.hostRegistryLoaded/);
  assert.match(fill, /this.controllers.get\(snapshot.serverId\) !== controller/);
  assert.match(fill, /snapshot.connectionStatus !== "online"/);
  assert.match(fill, /fillHostLabel\(\{ hosts: this.hosts, serverId: snapshot.serverId, info \}\)/);
  assert.match(fill, /this.hosts = next;\s*this.emitHostList\(\);\s*void this.persistHosts\(\)/);
  assert.doesNotMatch(fill, /(?:connectToDaemon|setHostsAndSync|updateHost)\(/);
});
