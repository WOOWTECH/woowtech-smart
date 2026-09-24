// woowtech smart has to run on the same machine as an upstream Paseo install, so
// it cannot share upstream's daemon home or port. These checks read the shipped
// sources directly, because an upstream merge can bring either default back in a
// file we never touched.
//
//   node --test woowtech/coexistence.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { findInShippedSources } from "./shipped-sources.mjs";

const repoRoot = new URL("../", import.meta.url);
const desktopDir = new URL("packages/desktop/", repoRoot);

function read(relativePath) {
  return readFileSync(new URL(relativePath, repoRoot), "utf8");
}

/** The single value captured by `pattern`, failing loudly when the shape changed upstream. */
function capture(source, pattern, what) {
  const match = pattern.exec(source);
  assert.ok(match, `could not find ${what}`);
  return match[1];
}

/**
 * The folder electron-updater downloads into, as the desktop package's electron-builder
 * writes it into app-update.yml. electron-builder derives it from the packaged package
 * name and ignores any value under `publish`, so ask electron-builder itself.
 */
async function builderUpdaterCacheDirName() {
  const { AppInfo, Packager } = createRequire(new URL("package.json", desktopDir))(
    "electron-builder",
  );
  const packager = new Packager({
    projectDir: fileURLToPath(desktopDir),
    config: "electron-builder.yml",
  });
  await packager.validateConfig();
  return new AppInfo(packager, null).updaterCacheDirName;
}

const DESKTOP_APP_ID = "io.woowtech.smart.desktop";
const APP_NAME = "woowtech smart";
const LINK_SCHEME = "woowtech-smart";

test("shipped code defaults to our daemon home, not upstream's ~/.paseo", () => {
  assert.deepEqual(findInShippedSources([/~\/\.paseo\b/]), []);
});

test("shipped code defaults to our port, not upstream's 6767", () => {
  assert.deepEqual(findInShippedSources([/\b6767\b/]), []);
});

test("the desktop app has its own id, name and update cache, used consistently", async () => {
  const builder = read("packages/desktop/electron-builder.yml");
  const main = read("packages/desktop/src/main.ts");
  const updater = read("packages/desktop/src/diagnostics/updater.ts");

  const appId = capture(builder, /^appId:\s*(.+?)\s*$/m, "appId in electron-builder.yml");
  assert.equal(appId, DESKTOP_APP_ID);
  assert.equal(capture(builder, /^productName:\s*(.+?)\s*$/m, "productName"), APP_NAME);
  // electron-builder names the .app and its binary after executableName but the Electron
  // helpers after productName, so keep them equal, as upstream does.
  assert.equal(capture(builder, /^executableName:\s*(.+?)\s*$/m, "executableName"), APP_NAME);
  // app.setName(APP_NAME) picks the userData folder, which must not be upstream's.
  assert.equal(capture(main, /const APP_NAME = .*\|\| "(.+?)";/, "APP_NAME in main.ts"), APP_NAME);
  assert.equal(
    capture(updater, /const SHIPIT_DIRECTORY_NAME = "(.+?)";/, "SHIPIT_DIRECTORY_NAME"),
    `${appId}.ShipIt`,
  );
  // The official Paseo downloads updates into @getpaseodesktop-updater, named after
  // upstream's package name.
  assert.equal(await builderUpdaterCacheDirName(), `${appId}-updater`);
});

test("the desktop app, mobile app, deep links and daemon share one link scheme", () => {
  const builder = read("packages/desktop/electron-builder.yml");
  const protocolBlock = capture(builder, /^protocols:\n((?:[ -].*\n)+)/m, "protocols block");
  const registeredSchemes = [...protocolBlock.matchAll(/^\s+- ([a-z][a-z0-9+.-]*)\s*$/gm)].map(
    (match) => match[1],
  );

  assert.deepEqual(registeredSchemes, [LINK_SCHEME]);
  assert.equal(
    capture(read("packages/desktop/src/main.ts"), /const APP_SCHEME = "(.+?)";/, "APP_SCHEME"),
    LINK_SCHEME,
  );
  assert.equal(
    capture(read("packages/app/app.config.js"), /^\s*scheme: "(.+?)",/m, "app.config.js scheme"),
    LINK_SCHEME,
  );
  assert.equal(
    capture(
      read("packages/protocol/src/agent-deep-link.ts"),
      /export const AGENT_DEEP_LINK_SCHEME = "(.+?)";/,
      "AGENT_DEEP_LINK_SCHEME",
    ),
    LINK_SCHEME,
  );
  assert.ok(
    read("packages/server/src/server/bootstrap.ts").includes(`"${LINK_SCHEME}://app"`),
    "the daemon does not admit the desktop renderer origin",
  );
});

test("the CLI and packaging scripts find the desktop app under our name", () => {
  const packagingScripts = [
    "packages/desktop/scripts/after-pack.js",
    "packages/desktop/scripts/after-sign.js",
    "packages/desktop/e2e/packaged-app-smoke.js",
  ];
  for (const script of packagingScripts) {
    assert.equal(
      capture(read(script), /const EXECUTABLE_NAME = "(.+?)";/, `EXECUTABLE_NAME in ${script}`),
      APP_NAME,
    );
  }
  assert.ok(
    read("packages/desktop/bin/paseo").includes(
      `Frameworks/${APP_NAME} Helper.app/Contents/MacOS/${APP_NAME} Helper`,
    ),
    "bin/paseo does not run the CLI through our Electron helper",
  );

  const upstreamAppLocations = [
    /Paseo\.app\b/,
    /Paseo Helper/,
    /Paseo\.exe/,
    /Paseo\.AppImage/,
    /Paseo\.desktop/,
    /\/opt\/Paseo\b/,
    /\/usr\/bin\/Paseo\b/,
    /"class", "Paseo"/,
    /--class=Paseo\b/,
    /appOutDir, "Paseo"/,
    /\.\.\/Paseo\b/,
  ];
  const filesThatLocateTheApp = [
    ...packagingScripts,
    "packages/desktop/scripts/linux-sandbox/index.js",
    "packages/desktop/bin/paseo",
    "packages/desktop/bin/paseo.cmd",
    "packages/desktop/src/main.ts",
    "packages/desktop/electron-builder.yml",
    "packages/cli/src/commands/open.ts",
  ];
  const offenders = filesThatLocateTheApp.flatMap((file) =>
    read(file)
      .split("\n")
      .flatMap((line, index) =>
        upstreamAppLocations.some((pattern) => pattern.test(line)) ? [`${file}:${index + 1}`] : [],
      ),
  );
  assert.deepEqual(offenders, []);
});
