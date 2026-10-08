// Merge guard for the desktop app's Electron fuses (README 第 26 節). electron-builder flips them
// right before signing. The built-in daemon, its supervisor and the bundled CLI run the app's
// binary with ELECTRON_RUN_AS_NODE, so RunAsNode has to stay on.
//
//   node --test woowtech/desktop-fuses.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const desktopDir = new URL("../packages/desktop/", import.meta.url);

/** The desktop config as electron-builder reads it. */
async function builderConfig() {
  const builder = createRequire(new URL("package.json", desktopDir))("electron-builder");
  const packager = new builder.Packager({
    projectDir: fileURLToPath(desktopDir),
    config: "electron-builder.yml",
  });
  await packager.validateConfig();
  return packager.config;
}

test("the desktop app ships with the fuses README section 26 lists", async () => {
  const { electronFuses } = await builderConfig();
  assert.deepEqual(electronFuses, {
    runAsNode: true,
    enableNodeOptionsEnvironmentVariable: true,
    enableNodeCliInspectArguments: false,
    onlyLoadAppFromAsar: true,
    enableEmbeddedAsarIntegrityValidation: true,
    grantFileProtocolExtraPrivileges: false,
  });
});

test("the daemon and the CLI still need RunAsNode", () => {
  // When neither starts the app's binary in Node mode any more, turn runAsNode off.
  const launcher = readFileSync(
    new URL("src/daemon/node-entrypoint-launcher.ts", desktopDir),
    "utf8",
  );
  const cli = readFileSync(new URL("bin/paseo", desktopDir), "utf8");
  assert.match(launcher, /ELECTRON_RUN_AS_NODE: "1"/);
  assert.match(cli, /ELECTRON_RUN_AS_NODE=1/);
});
