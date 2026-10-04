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
    /hasPendingGuiLaunchRequest: Boolean\(\s*pendingOpenProjectPath \|\|\s*pendingAgentNavigation \|\|\s*hasAppSchemeLink\(process.argv\) \|\|\s*hasWindowsLaunchFlag\(process.argv\),?\s*\)/,
  );
  // The second instance only hands over argv; it must not run the first instance's quit work.
  assert.match(main, /if \(!gotLock\) \{[\s\S]*?app.exit\(0\);\s*return false;/);
  assert.match(handler, /receiveAgentTarget\(agentTarget, "second-instance"\)/);
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
  assert.match(
    main,
    /isInstalledCopy: \(\) => existsSync\(windowsUninstallerPath\(process.execPath\)\)/,
  );
  const notifications = source("packages/desktop/src/features/notifications.ts");
  assert.match(
    notifications,
    /if \(process.platform === "win32"\) \{\s*log.info\("\[notification\] presenter", \{ supported: Notification.isSupported\(\) \}\);/,
  );
  const builder = source("packages/desktop/electron-builder.yml");
  assert.match(builder, /protocols:\s*\n\s*- name: [^\n]+\n\s*schemes:\s*\n\s*- woowtech-smart/);
  // Electron's own Start Menu link and the NSIS one must be the same file (README §25).
  assert.doesNotMatch(builder, /shortcutName:/);
  assert.match(builder, /- from: assets\/icon.ico\s*\n\s*to: icon.ico/);
  const winSection = builder.slice(builder.indexOf("\nwin:"), builder.indexOf("\nnsis:"));
  assert.doesNotMatch(winSection, /target: zip/, "a portable copy would take over the scheme");
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

test("Windows windows come to the front and the first close explains the tray (plan B4)", () => {
  const main = source("packages/desktop/src/main.ts");
  assert.match(
    main,
    /once\("ready-to-show", \(\) => \{[\s\S]*?if \(process.platform === "win32"\) raiseWindowsWindow\(mainWindow\);\s*else mainWindow.show\(\);/,
  );
  assert.match(
    main,
    /process.platform === "win32" \? \{ raise: \(\) => raiseWindowsWindow\(win\) \} : \{\}/,
  );
  assert.match(main, /if \(windowsTray\) \{\s*showTrayHintOnce\(\{/);
  const notifications = source("packages/desktop/src/features/notifications.ts");
  assert.match(
    notifications,
    /process.platform === "win32" \? \{ raise: \(\) => raiseWindowsWindow\(win\) \} : \{\}/,
  );
  const focus = source("packages/desktop/src/features/woowtech-windows-focus.ts");
  assert.match(focus, /if \(!win.isVisible\(\)\) \{\s*win.show\(\);/);
  assert.match(
    focus,
    /win.setAlwaysOnTop\(true\);\s*win.focus\(\);\s*win.setAlwaysOnTop\(false\);/,
  );
});

test("a real Windows uninstall removes the app's registrations and keeps user data (G6)", () => {
  const nsh = source("packages/desktop/build/installer.nsh");
  const code = nsh
    .split("\n")
    .filter((line) => !line.trim().startsWith(";"))
    .join("\n");
  const define = (name) => nsh.match(new RegExp(`^!define ${name} "([^"]+)"$`, "m"))?.[1];
  const ids = source("packages/desktop/src/features/woowtech-app-user-model-id.ts");
  assert.equal(
    define("WOOWTECH_TOAST_CLSID"),
    ids.match(/WOOWTECH_TOAST_ACTIVATOR_CLSID = "([^"]+)"/)[1],
  );
  assert.doesNotMatch(
    nsh,
    new RegExp(ids.match(/WOOWTECH_DEV_TOAST_ACTIVATOR_CLSID = "\{([^}]+)\}"/)[1]),
  );
  const builder = source("packages/desktop/electron-builder.yml");
  assert.equal(define("WOOWTECH_SCHEME"), builder.match(/schemes:\s*\n\s*- (\S+)/)[1]);
  // electron-updater names its cache after the sanitized package name, lower-cased.
  const packageName = builder.match(/extraMetadata:\s*\n\s*name: (\S+)/)[1];
  assert.equal(define("WOOWTECH_UPDATER_CACHE"), `${packageName.toLowerCase()}-updater`);
  // ${APP_ID} names Windows' notification settings key, which belongs to the AUMID.
  assert.equal(
    builder.match(/^appId: (\S+)$/m)[1],
    ids.match(/WOOWTECH_DESKTOP_APP_ID = "([^"]+)"/)[1],
  );
  // Install CLI writes the trampoline whose second line the uninstaller checks (G16).
  const shim = source("packages/desktop/src/integrations/cli-install/woowtech-windows-cli-shim.ts");
  assert.equal(
    shim.match(/export const WINDOWS_CLI_MARKER = "([^"]+)";/)?.[1],
    define("WOOWTECH_CLI_MARKER"),
  );
  assert.match(shim, /return \[\s*"@echo off",\s*MARKER_LINE,/);
  const install = source("packages/desktop/src/integrations/cli-install/install.ts");
  assert.match(
    install,
    /await fs.writeFile\(targetPath, renderWindowsCliTrampoline\(\{ shimPath \}\)\);/,
  );

  const start = code.indexOf("!macro customUnInstall");
  const uninstall = code.slice(start, code.indexOf("!macroend", start));
  // Updates and reinstalls run the old uninstaller with --updated; they must keep everything.
  assert.match(uninstall, /^!macro customUnInstall\n\s*\$\{ifNot\} \$\{isUpdated\}\n/);
  assert.match(uninstall, /\$\{endIf\}\n$/);
  assert.match(uninstall, /== '"\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}" "%1"'/);
  assert.match(uninstall, /== "\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}"/);
  // User data stays, like moving the Mac app to the Trash (D15).
  assert.doesNotMatch(uninstall, /\$APPDATA|\.woowtech-smart|\.local\\bin"/);
  // A failing old uninstaller aborts the update; -WX fails on a Var or Function one pass leaves unused.
  assert.doesNotMatch(code, /^\s*(Abort|Quit|MessageBox|Var|Function)\b/m);
  // Per-user only (D14).
  assert.match(code, /!macro customInstallMode\n\s*StrCpy \$isForceCurrentInstall "1"\n!macroend/);
  // electron-builder includes build/installer.nsh only by default; a custom script would also
  // stop it from signing the uninstaller.
  assert.doesNotMatch(builder.slice(builder.indexOf("\nnsis:")), /^\s+(include|script):/m);
  assert.doesNotMatch(builder, /buildResources:/);
});

test("Install CLI on Windows survives a Chinese user name and reaches PATH (G16)", () => {
  const install = source("packages/desktop/src/integrations/cli-install/install.ts");
  const windows = install.slice(install.indexOf('if (process.platform === "win32") {'));
  assert.match(windows, /renderWindowsCliTrampoline\(\{ shimPath \}\)/);
  assert.match(windows, /const userPath = await ensureWindowsUserPathEntry\(\);/);
  const ownership = source("packages/desktop/src/integrations/cli-install/ownership.ts");
  assert.match(
    ownership,
    /windowsShimPathExpression\(\{ shimPath: input.cliPath, env: process.env \}\)/,
  );
  // cmd.exe needs CRLF batch files; the Windows build gets them from git archive.
  assert.match(source(".gitattributes"), /^\*\.cmd text eol=crlf$/m);
  assert.match(source(".gitattributes"), /^\*\.bat text eol=crlf$/m);
});

test("only the release job signs Windows builds, every PE file, SHA-256 only (D8)", () => {
  const builder = source("packages/desktop/electron-builder.yml");
  const winSection = builder.slice(builder.indexOf("\nwin:"), builder.indexOf("\nnsis:"));
  assert.match(
    winSection,
    /signtoolOptions:\s*\n\s*sign: \.\/scripts\/woowtech-sign-windows\.js\s*\n\s*signingHashAlgorithms: \["sha256"\]\n/,
  );
  // Smart App Control checks every module that loads; the hook keeps Microsoft's signatures.
  assert.match(winSection, /signExts: \["\.dll", "\.node"\]/);
  // An unsigned test build carrying publisherName would refuse its own updates; the release job
  // passes it. A certificate here would make electron-builder sign without the hook's gate.
  assert.doesNotMatch(
    builder,
    /^\s*(publisherName|certificate(File|Password|SubjectName|Sha1)|azureSignOptions|forceCodeSigning):/m,
  );
  const hook = source("packages/desktop/scripts/woowtech-sign-windows.js");
  assert.match(hook, /if \(env.WOOWTECH_SIGN !== "1"\) \{\s*return \{ action: "skip"/);
  // jsign reads the eSigner password and TOTP secret from the environment, never from argv.
  assert.match(hook, /"--storepass",\s*"env:ESIGNER_STOREPASS",/);
  assert.match(hook, /"--keypass",\s*"env:ESIGNER_TOTP_SECRET",/);
  assert.doesNotMatch(hook, /env\.ESIGNER_(STOREPASS|TOTP_SECRET)/);
  assert.match(hook, /"--alg",\s*"SHA-256",[\s\S]*"--tsmode",\s*"RFC3161",/);
  // electron-builder would call an export named "sign" instead of the default one.
  assert.doesNotMatch(hook, /exports\.sign\b/);
});

test("Windows installs an update only from a silent restart, never at quit (G37, D20)", () => {
  const updater = source("packages/desktop/src/features/auto-updater.ts");
  assert.match(updater, /!installsUpdateOnQuit\(process.platform\)/);
  assert.match(
    updater,
    /const \{ isSilent, isForceRunAfter \} = updateInstallMode\(\{\s*platform: process.platform,\s*\.\.\.requested,\s*\}\);/,
  );
  assert.match(updater, /autoUpdater.quitAndInstall\(isSilent, isForceRunAfter\);/);
});
