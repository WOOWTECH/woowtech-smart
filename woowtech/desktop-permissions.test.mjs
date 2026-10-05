// Merge guard for the Mac app's permission prompts (README 第 6 節). Electron's own purpose
// strings are generic English ("This app needs access to the microphone"); ours name the app
// and the purpose in English (electron-builder.yml mac.extendInfo) and in Traditional and
// Simplified Chinese (InfoPlist.strings that mac.extraResources copies into the bundle's
// Resources/<lang>.lproj). The desktop app asks only for the microphone, for dictation
// (getUserMedia with audio; entitlements.mac.plist grants only audio-input).
//
//   node --test woowtech/desktop-permissions.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = new URL("../", import.meta.url);
const desktopDir = new URL("packages/desktop/", repoRoot);

const PURPOSE_KEYS = ["NSMicrophoneUsageDescription"];
// Electron's bundle already has these lproj folders (Chromium's names for Traditional and
// Simplified Chinese). A zh-Hant.lproj beside its empty zh_TW.lproj would give the app two
// Traditional Chinese localizations.
const LOCALIZATIONS = {
  zh_TW: /^允許「渥屋智能」/,
  zh_CN: /^允许“渥屋智能”/,
};

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

/** An old-style .strings file's entries (no escapes in values); fails on anything else. */
function parseStrings(text, file) {
  const body = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const entry = /\s*"([^"\\]+)"\s*=\s*"([^"\\]*)"\s*;/y;
  const entries = {};
  while (body.slice(entry.lastIndex).trim() !== "") {
    const start = entry.lastIndex;
    const match = entry.exec(body);
    assert.ok(match, `${file}: not a "key" = "value"; entry at ${body.slice(start).trim()}`);
    entries[match[1]] = match[2];
  }
  return entries;
}

test("macOS explains each permission in English, Traditional and Simplified Chinese", async () => {
  const { mac } = await builderConfig();
  const extendInfo = mac.extendInfo ?? {};
  const purposeKeys = Object.keys(extendInfo).filter((key) => key.endsWith("UsageDescription"));
  assert.deepEqual(purposeKeys, PURPOSE_KEYS, "mac.extendInfo purpose strings");
  for (const key of PURPOSE_KEYS) {
    assert.match(
      extendInfo[key],
      /^Allow woowtech smart to .{20,}\.$/,
      `${key}: ${extendInfo[key]}`,
    );
  }

  for (const [lproj, start] of Object.entries(LOCALIZATIONS)) {
    const source = `assets/lproj/${lproj}.lproj`;
    const file = fileURLToPath(new URL(`${source}/InfoPlist.strings`, desktopDir));
    assert.ok(existsSync(file), `${source}/InfoPlist.strings is missing`);
    const entries = parseStrings(readFileSync(file, "utf8"), file);
    assert.deepEqual(Object.keys(entries), PURPOSE_KEYS, `${lproj} keys`);
    for (const [key, text] of Object.entries(entries)) {
      assert.match(text, start, `${lproj} ${key}: ${text}`);
      assert.doesNotMatch(text, /\$\(|Allow|Paseo|Electron/, `${lproj} ${key}: ${text}`);
    }
    if (process.platform === "darwin") {
      const asJson = execFileSync("plutil", ["-convert", "json", "-o", "-", file], {
        encoding: "utf8",
      });
      assert.deepEqual(JSON.parse(asJson), entries, `plutil reads ${file} differently`);
    }

    // mac.extraResources land in the app's Contents/Resources.
    assert.ok(
      (mac.extraResources ?? []).some(
        (resource) => resource.from === source && resource.to === `${lproj}.lproj`,
      ),
      `mac.extraResources does not copy ${source} to ${lproj}.lproj`,
    );
    const electronResources = new URL(
      "node_modules/electron/dist/Electron.app/Contents/Resources/",
      repoRoot,
    );
    if (existsSync(electronResources)) {
      assert.ok(
        existsSync(new URL(`${lproj}.lproj`, electronResources)),
        `Electron has no ${lproj}.lproj`,
      );
    }
  }
});
