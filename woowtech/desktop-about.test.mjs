// The Mac app's About window and Finder's Get Info name WOOW TECH as the copyright holder
// and the About window shows the product website (woowtech/README.md, 第 6 節). Left alone,
// electron-builder writes "Copyright © <year> <package.json author>", and the desktop's
// package.json author is upstream's, synced from the root package.json. A merge can drop
// electron-builder.yml's `copyright`, main.ts's setAboutPanelOptions call or the menu's
// native About item. These checks ask electron-builder for the copyright it writes, run
// the About options from source and read the two upstream seams. The options read
// @getpaseo/protocol's dist, so build it first: npm run build:server.
//
//   node --test woowtech/desktop-about.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { requireSource } from "./source-modules.mjs";

const repoRoot = new URL("../", import.meta.url);
const desktopDir = new URL("packages/desktop/", repoRoot);

const COPYRIGHT = "© 2026 WOOW TECH CO., LTD.";
const WEBSITE = "https://aiot.woowtech.io/";

function read(relativePath) {
  return readFileSync(new URL(relativePath, repoRoot), "utf8");
}

const electronBuilder = () =>
  createRequire(new URL("package.json", desktopDir))("electron-builder");

/** The copyright line electron-builder writes into Info.plist (NSHumanReadableCopyright). */
async function builderCopyright() {
  const builder = electronBuilder();
  const packager = new builder.Packager({
    projectDir: fileURLToPath(desktopDir),
    config: "electron-builder.yml",
  });
  await packager.validateConfig();
  return new builder.AppInfo(packager, null).copyright;
}

test("the packaged app names WOOW TECH as the copyright holder", async () => {
  assert.equal(await builderCopyright(), COPYRIGHT);
});

test("the About window shows the same copyright and the website", async () => {
  const { woowtechAboutPanelOptions } = requireSource(
    "packages/desktop/src/features/woowtech-about-panel.ts",
  );
  // No applicationName, applicationVersion or version: those keep the app's own.
  assert.deepEqual(woowtechAboutPanelOptions(), {
    copyright: await builderCopyright(),
    credits: WEBSITE,
    website: WEBSITE,
  });
});

test("the main process sets the About options before the app is ready", () => {
  const main = read("packages/desktop/src/main.ts");
  const call = "app.setAboutPanelOptions(woowtechAboutPanelOptions());";
  assert.equal(main.split(call).length - 1, 1, `main.ts calls ${call} once`);
  assert.ok(
    main.indexOf(call) < main.indexOf("await app.whenReady()"),
    "main.ts sets the About options after app.whenReady()",
  );
  assert.ok(
    main.includes(
      'import { woowtechAboutPanelOptions } from "./features/woowtech-about-panel.js";',
    ),
    "main.ts does not import woowtechAboutPanelOptions",
  );
  // The macOS app menu's About item is Electron's native panel, which shows the options.
  const menu = read("packages/desktop/src/features/menu.ts");
  assert.match(menu, /\{ role: "about" as const \}/, "the app menu has no native About item");
  assert.doesNotMatch(
    main,
    /showAboutPanel|setAboutPanelOptions\((?!woowtechAboutPanelOptions)/,
    "main.ts shows or sets other About options",
  );
});
