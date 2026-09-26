// woowtech smart has to run on the same machine as an upstream Paseo install, so
// it cannot share upstream's daemon home or port. These checks read the shipped
// sources directly, and run the desktop's login shell merge from source, because
// an upstream merge can bring either default back in a file we never touched.
//
//   node --test woowtech/coexistence.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { findInShippedSources } from "./shipped-sources.mjs";
import { requireSource } from "./source-modules.mjs";

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

/** `file:line` for every line of `file` that matches one of `patterns`. */
function linesMatching(file, patterns) {
  return read(file)
    .split("\n")
    .flatMap((line, index) =>
      patterns.some((pattern) => pattern.test(line)) ? [`${file}:${index + 1}`] : [],
    );
}

const electronBuilder = () =>
  createRequire(new URL("package.json", desktopDir))("electron-builder");

/** The desktop package as electron-builder reads it, with extraMetadata applied. */
async function desktopPackager() {
  const packager = new (electronBuilder().Packager)({
    projectDir: fileURLToPath(desktopDir),
    config: "electron-builder.yml",
  });
  await packager.validateConfig();
  return packager;
}

/**
 * The folder electron-updater downloads into, as the desktop package's electron-builder
 * writes it into app-update.yml. electron-builder derives it from the packaged package
 * name and ignores any value under `publish`, so ask electron-builder itself.
 */
async function builderUpdaterCacheDirName() {
  return new (electronBuilder().AppInfo)(await desktopPackager(), null).updaterCacheDirName;
}

test("desktop packaging excludes relay deployment configs without excluding its runtime", async () => {
  const { config } = await desktopPackager();
  const filters = new Set(config.files.flatMap((entry) => entry.filter));
  assert.ok(
    filters.has("!node_modules/@getpaseo/relay/wrangler*.toml"),
    "relay deployment configs must not ship inside the desktop app",
  );
  assert.equal(filters.has("!node_modules/@getpaseo/relay/**"), false);
});

const DESKTOP_APP_ID = "io.woowtech.smart.desktop";
const APP_NAME = "woowtech smart";
const LINK_SCHEME = "woowtech-smart";

test("shipped code defaults to our daemon home, not upstream's ~/.paseo", () => {
  assert.deepEqual(findInShippedSources([/~\/\.paseo\b/]), []);
});

test("shipped code defaults to our port, not upstream's 6767", () => {
  assert.deepEqual(findInShippedSources([/\b6767\b/]), []);
});

/** A stand-in for the user's login shell, whose profile ends with `shellEnv`. */
function loginShellWith(shellEnv) {
  return (_shell, args) => {
    const command = String(args.at(-1));
    const marker = /"([0-9a-f]{12})" \+ JSON\.stringify\(process\.env\) \+ "\1"/.exec(command)?.[1];
    assert.ok(
      marker,
      `the desktop reads the login shell's environment differently now: ${command}`,
    );
    const stdout = `${marker}${JSON.stringify(shellEnv)}${marker}`;
    return { pid: 0, output: [null, stdout, ""], stdout, stderr: "", status: 0, signal: null };
  };
}

test("the desktop app keeps its own daemon home and host when the login shell exports Paseo's", () => {
  // People who also use the official Paseo may export these in their shell
  // profile. The desktop app merges its login shell's environment at startup;
  // following them would move our daemon into ~/.paseo and send our CLI to
  // Paseo's daemon.
  const { inheritLoginShellEnv } = requireSource("packages/desktop/src/login-shell-env.ts", {
    "electron-log/main": { info() {}, warn() {} },
  });
  const quietLogger = { info() {}, warn() {} };
  const shellProfile = {
    HOME: "/Users/someone",
    SHELL: "/bin/zsh",
    PATH: "/opt/homebrew/bin:/usr/bin:/bin",
    PASEO_HOME: "/Users/someone/.paseo",
    PASEO_HOST: "127.0.0.1:6767",
  };
  const launchedFromDock = { HOME: "/Users/someone", SHELL: "/bin/zsh", PATH: "/usr/bin:/bin" };
  // The desktop e2e and smoke tests launch the app with a home of their own.
  const launchedByTests = {
    ...launchedFromDock,
    PASEO_HOME: "/tmp/e2e-home",
    PASEO_HOST: "unused:1",
  };

  for (const env of [launchedFromDock, launchedByTests]) {
    const launchTarget = { PASEO_HOME: env.PASEO_HOME, PASEO_HOST: env.PASEO_HOST };
    inheritLoginShellEnv({
      env,
      logger: quietLogger,
      platform: "darwin",
      spawnSync: loginShellWith(shellProfile),
    });
    assert.equal(env.PATH, shellProfile.PATH, "the login shell's environment was not merged");
    assert.deepEqual({ PASEO_HOME: env.PASEO_HOME, PASEO_HOST: env.PASEO_HOST }, launchTarget);
  }
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
  // On Linux, electron-builder names the desktop entry after executableName, and the
  // packaged package.json's desktopName tells Electron which entry is the app's. The
  // packaged-app smoke in CI checks that they match.
  assert.equal((await desktopPackager()).metadata.desktopName, `${APP_NAME}.desktop`);
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
    linesMatching(file, upstreamAppLocations),
  );
  assert.deepEqual(offenders, []);
});
