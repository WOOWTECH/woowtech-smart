// What people see woowtech smart called: installer files, app text outside the
// translations, and the mobile app's name. Upstream merges can bring "Paseo"
// back in files we never touched, so these checks read the sources directly.
//
//   node --test woowtech/names.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { expoIntrospectedConfig, expoPrebuildConfig } from "./expo-config.mjs";
import { findInShippedSources } from "./shipped-sources.mjs";

const repoRoot = new URL("../", import.meta.url);

function read(relativePath) {
  return readFileSync(new URL(relativePath, repoRoot), "utf8");
}

test("installers are named woowtech-smart and the app links to the dmg the mac build makes", () => {
  const builder = read("packages/desktop/electron-builder.yml");
  const artifactNames = [...builder.matchAll(/^\s*artifactName:\s*"(.+?)"\s*$/gm)].map(
    (match) => match[1],
  );

  assert.ok(artifactNames.length > 0, "electron-builder.yml names no artifacts");
  for (const name of artifactNames) {
    assert.match(name, /^woowtech-smart-/);
  }

  const macArtifact = /^mac:\n(?:[ ].*\n)*?\s+artifactName:\s*"(.+?)"/m.exec(builder)?.[1];
  assert.ok(macArtifact, "could not find the mac artifactName");
  const dmgLink = /\/v\$\{normalizedVersion\}\/(.+?)"?`;/.exec(
    read("packages/app/src/desktop/updates/desktop-updates.ts"),
  )?.[1];
  assert.ok(dmgLink, "could not find the Apple Silicon download link");
  assert.equal(
    dmgLink.replaceAll("${normalizedVersion}", "${version}"),
    macArtifact.replace("${arch}", "arm64").replace("${ext}", "dmg"),
  );
});

test("app text outside the translations names woowtech smart", () => {
  const naming = findInShippedSources([/\bPaseo\b/], {
    dirs: ["packages/app/src", "packages/app/public"],
    fileTypes: /\.(?:[cm]?[jt]sx?|json|html)$/,
    // Translations are renamed as they load (packages/app/src/i18n/brand.ts).
    skipPaths: ["packages/app/src/i18n/resources/", "packages/app/src/i18n/brand.ts"],
    skipComments: true,
    allowLines: [
      // Matches the daemon's English error text to pick a translation; the user
      // sees the translation, which is renamed.
      /"Archive isn't available here because this workspace was not created as a Paseo worktree":/,
    ],
  });

  assert.deepEqual(naming, []);
});

test("the daemon's processes are titled woowtech smart in Activity Monitor and ps", () => {
  // The official Paseo's are "Paseo Supervisor" and "Paseo Daemon": the same
  // titles made the two apps' daemons look alike, and `pkill -f 'Paseo Daemon'`
  // stopped both. Nothing looks the daemon up by its title.
  const titleIn = (relativePath) => /^process\.title = "(.+?)";$/m.exec(read(relativePath))?.[1];

  assert.equal(
    titleIn("packages/server/scripts/supervisor-entrypoint.ts"),
    "woowtech smart Supervisor",
  );
  assert.equal(titleIn("packages/server/src/server/daemon-worker.ts"), "woowtech smart Daemon");
  // The local speech worker, which runs only where local speech is installed.
  assert.equal(
    titleIn("packages/server/src/server/speech/providers/local/worker-process.ts"),
    "woowtech smart Voice",
  );
});

test("the daemon's messages name woowtech smart", () => {
  // Errors and upgrade prompts the app and the CLI show, the diagnostics report
  // people send us, and the text of pull requests the daemon opens on GitHub. They
  // name the product with PRODUCT_NAME (packages/protocol/src/brand-name.ts).
  const naming = findInShippedSources([/\bPaseo\b/], {
    dirs: ["packages/server/src"],
    skipComments: true,
    skipPaths: [
      // Tool descriptions and results that only agents read. Agents reach these tools
      // through the MCP server named paseo, which upstream's tool-name handling needs.
      "packages/server/src/server/agent/tools/paseo-tools.ts",
      "packages/server/src/server/browser-tools/tools.ts",
      // Voice-mode instructions for the agent. Voice mode needs local speech, which
      // woowtech smart does not ship.
      "packages/server/src/server/voice-config.ts",
    ],
    allowLines: [
      // Upstream's plugin API: its name, and the Paseo versions plugins are written for.
      /Plugin Paseo (?:API|session host)/,
      /made for an older version of Paseo and cannot run on Paseo v/,
      // Text written for an agent: a forked agent's chat history, review comments, and
      // errors from the bridges between the daemon and a provider's own plugin.
      /Chat history from a previous Paseo agent/,
      /Paseo review attachment/,
      /before Paseo tools were registered/,
      /Internal Paseo [\w ]+ bridge/,
      /Paseo OpenCode bridge failed/,
      /not bound to a Paseo agent|Paseo tools are disabled for this session/,
      // daemon.log
      /\blogger\.(?:trace|debug|info|warn|error)\(/,
    ],
  });

  assert.deepEqual(naming, []);
});

test("the daemon introduces itself to agents as woowtech smart", () => {
  assert.deepEqual(
    findInShippedSources([/clientInfo:\s*\{\s*name:\s*"Paseo/], { dirs: ["packages/server/src"] }),
    [],
  );
});

test("the mobile app is woowtech smart, and 渥屋智能 on Chinese devices", () => {
  for (const [variant, nameSuffix, idSuffix] of [
    ["production", "", ""],
    ["development", " Debug", ".debug"],
  ]) {
    const config = expoPrebuildConfig(variant);
    const displayNames = Object.fromEntries(
      Object.entries(config.locales).map(([language, strings]) => [
        language,
        strings.CFBundleDisplayName,
      ]),
    );

    assert.equal(config.name, `woowtech smart${nameSuffix}`);
    assert.equal(config.ios.bundleIdentifier, `io.woowtech.smart${idSuffix}`);
    assert.equal(config.android.package, `io.woowtech.smart${idSuffix}`);
    assert.deepEqual(displayNames, {
      "zh-Hans": `渥屋智能${nameSuffix}`,
      "zh-Hant": `渥屋智能${nameSuffix}`,
    });
    // Expo applies `locales` to iOS only; this plugin carries them to Android.
    assert.ok(
      config._internal?.pluginHistory?.["with-localized-app-name"],
      `${variant}: Android launchers would not get the localized name`,
    );
  }
});

// When the display name does not fit under the icon, as "woowtech smart Debug"
// does not, SpringBoard labels it with the short name (CFBundleName). Expo leaves
// that at $(PRODUCT_NAME), the name without its spaces, which read "woowtechsmart…".
test("the iOS home screen falls back to a readable short name", () => {
  for (const variant of ["production", "development"]) {
    // The introspected Info.plist starts from packages/app/ios when a prebuild left
    // one, so it can still hold the short name after app.config.js stops setting it.
    assert.equal(
      expoPrebuildConfig(variant).ios.infoPlist?.CFBundleName,
      "woowtech smart",
      `${variant}: app.config.js sets no ios.infoPlist.CFBundleName`,
    );
    const { ios, locales } = expoIntrospectedConfig(variant);
    const shortNames = [
      ios.infoPlist.CFBundleName,
      locales["zh-Hans"].CFBundleName,
      locales["zh-Hant"].CFBundleName,
    ];

    assert.deepEqual(shortNames, ["woowtech smart", "渥屋智能", "渥屋智能"], variant);
    for (const name of shortNames) {
      // Apple's limit for CFBundleName.
      assert.ok([...name].length <= 15, `${variant}: "${name}" is longer than 15 characters`);
    }
  }
});
