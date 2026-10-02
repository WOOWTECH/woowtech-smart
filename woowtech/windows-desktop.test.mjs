// Merge guards for the Windows desktop seams (README §25): tray parity with the macOS Dock,
// protocol toasts, launch-link redaction and the macOS Notification Center relaunch. The
// policies have unit tests in packages/desktop/src/features/woowtech-*.test.ts.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("closing the last window keeps the Windows app in the tray", () => {
  const main = source("packages/desktop/src/main.ts");
  assert.match(
    main,
    /app.on\("window-all-closed", \(\) => \{[\s\S]*?quitWhenAllWindowsClosed\(\{ platform: process.platform, trayActive: windowsTray !== null \}\)[\s\S]*?app.quit\(\)/,
  );
  assert.doesNotMatch(main, /if \(process.platform !== "darwin"\) \{\s*app.quit\(\);/);
  const tray = main.indexOf("windowsTray = createWindowsTray({");
  assert.ok(tray > main.indexOf("await app.whenReady()"), "Tray needs a ready app");
  assert.match(
    main,
    /if \(process.platform === "win32"\) \{\s*windowsTray = createWindowsTray\(\{/,
  );
  assert.match(main, /onOpen: \(\) => \{\s*void desktopWindowOwner.showOrOpenPrimary\(\)/);
  assert.match(main, /onQuit: \(\) => app.quit\(\)/);
});

test("a second launch on Windows brings back the window and never logs a pairing secret", () => {
  const main = source("packages/desktop/src/main.ts");
  const handler = main.slice(main.indexOf('app.on("second-instance"'));
  assert.match(handler, /redactLaunchArguments\(commandLine\)/);
  assert.match(handler, /hasAppLink: hasAppSchemeLink\(commandLine\)/);
  assert.match(handler, /desktopWindowOwner.showOrOpenPrimary\(\)/);
  assert.doesNotMatch(main, /log\.\w+\([^;]*?,\s*commandLine\)/);
  assert.doesNotMatch(main, /log\.\w+\([^;]*?,\s*process\.argv\)/);
  assert.match(main, /log.info\("\[open-project\] argv:", redactLaunchArguments\(process.argv\)\)/);
  assert.match(
    main,
    /hasPendingGuiLaunchRequest: Boolean\(\s*pendingOpenProjectPath \|\| pendingAgentNavigation \|\| hasAppSchemeLink\(process.argv\),?\s*\)/,
  );
});

test("the packaged Windows app registers woowtech-smart: before notifications are posted", () => {
  const main = source("packages/desktop/src/main.ts");
  const registration = main.indexOf("agentLinkProtocolRegistered = registerAgentLinkProtocol({");
  assert.ok(registration > main.indexOf("await app.whenReady()"));
  assert.ok(registration < main.indexOf("registerNotificationHandlers({"));
  assert.match(
    main,
    /setAsDefaultProtocolClient: \(scheme\) => app.setAsDefaultProtocolClient\(scheme\)/,
  );
  const builder = source("packages/desktop/electron-builder.yml");
  assert.match(builder, /protocols:\s*\n\s*- name: [^\n]+\n\s*schemes:\s*\n\s*- woowtech-smart/);
  // Electron's own Start Menu link and the NSIS one must be the same file (README §25).
  assert.doesNotMatch(builder, /shortcutName:/);
  assert.match(builder, /- from: assets\/icon.ico\s*\n\s*to: icon.ico/);
});

test("Windows agent notifications are protocol toasts kept clickable in Action Center", () => {
  const notifications = source("packages/desktop/src/features/notifications.ts");
  assert.match(notifications, /shouldUseProtocolToast\(\{/);
  assert.match(notifications, /toastXml: protocolToast/);
  assert.match(notifications, /keepAfterTimedOutClose: process.platform === "win32"/);
  assert.match(notifications, /options.openAgent\(agent, "notification-click"\)/);
  assert.match(notifications, /trackNotification\(notification\)/);
});

test("macOS reopens the agent of a Notification Center click that relaunched the app", () => {
  const notifications = source("packages/desktop/src/features/notifications.ts");
  assert.match(
    notifications,
    /agent && process.platform === "darwin" \? agentNotificationId\(agent, randomUUID\(\)\) : null/,
  );
  const main = source("packages/desktop/src/main.ts");
  const ready = main.indexOf('app.once("ready", (_event, launchInfo) => {');
  assert.notEqual(ready, -1);
  assert.ok(ready < main.indexOf("void runDesktopStartup({"), "registered before startup runs");
  assert.match(main.slice(ready), /agentTargetFromLaunchInfo\(launchInfo\)/);
});

test("only a packaged test build runs the built-in daemon with mock providers (G26)", () => {
  const launcher = source("packages/desktop/src/daemon/node-entrypoint-launcher.ts");
  assert.match(
    launcher,
    /const production = options\?\.isPackaged === true && options\.testBuild !== true;/,
  );
  const runtimePaths = source("packages/desktop/src/daemon/runtime-paths.ts");
  assert.match(runtimePaths, /testBuild: isWoowtechTestBuild\(\),/);
  assert.match(runtimePaths, /readWoowtechTestBuild\(\{\s*isPackaged: app.isPackaged,/);
  // Release workflows must never package a test build.
  for (const workflow of readdirSync(new URL("../.github/workflows/", import.meta.url))) {
    assert.doesNotMatch(source(`.github/workflows/${workflow}`), /woowtechTestBuild/, workflow);
  }
});
