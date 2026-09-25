// What people see woowtech smart called: installer files, app text outside the
// translations, and the mobile app's name. Upstream merges can bring "Paseo"
// back in files we never touched, so these checks read the sources directly.
//
//   node --test woowtech/names.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { expoPrebuildConfig } from "./expo-config.mjs";
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
    const chineseName = { CFBundleDisplayName: `渥屋智能${nameSuffix}` };

    assert.equal(config.name, `woowtech smart${nameSuffix}`);
    assert.equal(config.ios.bundleIdentifier, `io.woowtech.smart${idSuffix}`);
    assert.equal(config.android.package, `io.woowtech.smart${idSuffix}`);
    assert.deepEqual(config.locales, { "zh-Hans": chineseName, "zh-Hant": chineseName });
    // Expo applies `locales` to iOS only; this plugin carries them to Android.
    assert.ok(
      config._internal?.pluginHistory?.["with-localized-app-name"],
      `${variant}: Android launchers would not get the localized name`,
    );
  }
});
