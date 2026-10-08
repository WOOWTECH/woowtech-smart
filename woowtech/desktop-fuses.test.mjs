// Merge guard for the desktop app's Electron fuses (README 第 26 節). scripts/after-pack.js flips
// them before signing and before the Linux launcher replaces the Electron binary with a script.
// The built-in daemon, its supervisor and the bundled CLI run the app's binary with
// ELECTRON_RUN_AS_NODE, so RunAsNode has to stay on.
//
//   node --test woowtech/desktop-fuses.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const desktopDir = new URL("../packages/desktop/", import.meta.url);
const requireDesktop = createRequire(new URL("package.json", desktopDir));

/** The desktop config as electron-builder reads it. */
async function builderConfig() {
  const builder = requireDesktop("electron-builder");
  const packager = new builder.Packager({
    projectDir: fileURLToPath(desktopDir),
    config: "electron-builder.yml",
  });
  await packager.validateConfig();
  return packager.config;
}

test("after-pack flips the fuses README section 26 lists", () => {
  const { WOOWTECH_FUSES } = requireDesktop("./scripts/woowtech-fuses.js");
  assert.deepEqual(WOOWTECH_FUSES, {
    runAsNode: true,
    enableNodeOptionsEnvironmentVariable: true,
    enableNodeCliInspectArguments: false,
    onlyLoadAppFromAsar: true,
    enableEmbeddedAsarIntegrityValidation: true,
    grantFileProtocolExtraPrivileges: false,
  });
  const afterPack = readFileSync(new URL("scripts/after-pack.js", desktopDir), "utf8");
  const flip = afterPack.indexOf("await flipWoowtechFuses(context);");
  assert.ok(flip > 0, "after-pack.js flips the fuses");
  assert.ok(flip < afterPack.indexOf("installLinuxLauncher(context.appOutDir)"));
  // The electron-builder methods it relies on (its afterPack docs show addElectronFuses).
  const builder = requireDesktop("electron-builder");
  for (const packager of [builder.MacPackager, builder.WinPackager, builder.LinuxPackager]) {
    assert.equal(typeof packager.prototype.addElectronFuses, "function", packager.name);
    assert.equal(typeof packager.prototype.generateFuseConfig, "function", packager.name);
  }
});

test("electron-builder does not flip fuses again after the Linux launcher is in place", async () => {
  const config = await builderConfig();
  assert.equal(config.electronFuses, undefined);
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
