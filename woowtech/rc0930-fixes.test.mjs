// Merge guards for the fixes to what the 2026-09-30 release-candidate run found (woowtech/README.md
// sections 14 and 21; plans/rc-reverify-1008.md in the working folder). Each fix is a small seam
// in an upstream file; the behavior is tested next to the fork files in packages/app.
//
//   node --test woowtech/rc0930-fixes.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("settings pages get the iOS swipe back on an iPhone-width layout (RC-I-09f)", () => {
  const layout = source("packages/app/src/app/_layout.tsx");
  assert.match(layout, /const settingsOptions = useSettingsScreenOptions\(\);/);
  const settingsScreens = [
    "settings/index",
    "settings/[section]",
    "settings/hosts/[serverId]/index",
    "settings/hosts/[serverId]/[hostSection]",
    "settings/hosts/[serverId]/plugins/[pluginId]/[screenId]",
    "settings/hosts/[serverId]/projects/index",
    "settings/hosts/[serverId]/projects/[projectId]",
  ];
  for (const name of settingsScreens) {
    const escaped = name.replace(/[[\]/]/g, (char) => `\\${char}`);
    assert.match(
      layout,
      new RegExp(`name="${escaped}"\\s+options=\\{settingsOptions\\}`),
      `${name} has no swipe-back options`,
    );
  }
});

test("the file explorer reloads once the host is back (RC-A-14, RC-D-12b)", () => {
  const pane = source("packages/app/src/components/file-explorer-pane.tsx");
  assert.match(pane, /const isHostConnected = useHostRuntimeIsConnected\(serverId\);/);
  assert.match(
    pane,
    /useRetryExplorerOnReconnect\(\{\s*isConnected: isHostConnected,\s*hasError: Boolean\(error\),\s*retry: handleRetry,\s*\}\);/,
  );
});

test("desktop attachments take the extension from the file name only (RC-D-12c1)", () => {
  const store = source("packages/app/src/desktop/attachments/desktop-attachment-store.ts");
  assert.match(store, /const fromName = attachmentExtensionFromName\(input\.fileName\);/);
  assert.match(store, /const fromSourcePath = attachmentExtensionFromName\(input\.sourcePath\);/);
  assert.doesNotMatch(store, /getFileExtensionFromName/);
});

test("host lists show each host's address, so hosts with the same name differ (K-34)", () => {
  for (const path of [
    "packages/app/src/screens/new-workspace-screen.tsx",
    "packages/app/src/components/hosts/host-filter.tsx",
  ]) {
    assert.match(source(path), /<HostPicker[^>]*?\bshowActiveConnection\b/s, path);
  }
  assert.match(
    source("packages/app/src/components/schedules/schedule-form-sheet.tsx"),
    /const connectionLabel = useHostConnectionLabel\(option\.value\);[\s\S]*?description=\{connectionLabel\}/,
  );
  assert.match(
    source("packages/app/src/hosts/host-chooser.tsx"),
    /\{connectionLabel \?\? host\.serverId\}/,
  );
});
