// Merge guards for the Windows desktop seams (README §31): tray parity with the macOS Dock,
// protocol toasts and launch-link redaction. The macOS Notification Center relaunch has its own
// guard (desktop-notification-launch.test.mjs). The policies have unit tests in
// packages/desktop/src/features/woowtech-*.test.ts.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

import YAML from "yaml";

import { appliedBrand } from "./brands/index.cjs";

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

test("the packaged Windows app registers its agent-link scheme before notifications are posted", () => {
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
  // The brand's scheme: woowtech-smart: in this repository, apporosmart: in Apporo smart's tree.
  const { scheme } = appliedBrand();
  assert.match(
    builder,
    new RegExp(String.raw`protocols:\s*\n\s*- name: [^\n]+\n\s*schemes:\s*\n\s*- ${scheme}\n`),
  );
  // Electron's own Start Menu link and the NSIS one must be the same file (README §31).
  assert.doesNotMatch(builder, /shortcutName:/);
  assert.match(builder, /- from: assets\/icon.ico\s*\n\s*to: icon.ico/);
  const winSection = builder.slice(builder.indexOf("\nwin:"), builder.indexOf("\nnsis:"));
  assert.doesNotMatch(winSection, /target: zip/, "a portable copy would take over the scheme");
});

test("the Windows installer is x64 only, whatever the command line says (D11)", () => {
  const builder = source("packages/desktop/electron-builder.yml");
  const winSection = builder.slice(builder.indexOf("\nwin:"), builder.indexOf("\nnsis:"));
  // A second architecture here also makes a combined installer, and latest.yml points at it.
  assert.match(winSection, /- target: nsis\n\s+arch:\n\s+- x64$/);
});

test("Windows names the brand's company, not upstream's author, as the publisher", () => {
  const brand = appliedBrand();
  const { extraMetadata } = YAML.parse(source("packages/desktop/electron-builder.yml"));
  // electron-builder reads CompanyName and the Apps & features publisher from author.name, and
  // the installer's FileDescription from description. package.json still has upstream's.
  assert.equal(extraMetadata.author.name, brand.company.copyright.replace(/^© \d{4} /, ""));
  assert.equal(extraMetadata.description, `${brand.name} desktop app`);
});

test("Windows' Apps & features links point at the brand's website, not upstream's", () => {
  const brand = appliedBrand();
  const { extraMetadata } = YAML.parse(source("packages/desktop/electron-builder.yml"));
  // electron-builder writes package.json's homepage into the uninstall entry (the help, about and
  // update links in Apps & features) and into the Linux packages' Homepage. In package.json it is
  // still https://paseo.sh.
  assert.equal(extraMetadata.homepage, `https://${brand.links.websiteHost}/`);
});

test("the Windows installer has no folder page: it installs where the update will look (2026-11-05)", () => {
  const { nsis } = YAML.parse(source("packages/desktop/electron-builder.yml"));
  // Owner decision of 2026-11-05 (README §31): one install folder under the user's profile. A folder the
  // user picks multiplies what has to work: a protected folder fails for a per-user install without UAC, and
  // Chinese, spaces, & and % in a path each need care. IT can still pass /D=<folder> to a silent install.
  assert.equal(nsis.allowToChangeInstallationDirectory, false);
  assert.equal(nsis.perMachine, false);
});

test("the Windows build does not need the symlink privilege", () => {
  // Without this electron-builder unpacks the legacy winCodeSign archive, which holds symlinks,
  // and a normal Windows account fails with exit status 2 (README §31).
  const builder = source("packages/desktop/electron-builder.yml");
  assert.match(builder, /\ntoolsets:\n\s+winCodeSign: "1\.1\.0"\n/);
});

test("Windows agent notifications are protocol toasts kept clickable in Action Center", () => {
  const notifications = source("packages/desktop/src/features/notifications.ts");
  assert.match(notifications, /shouldUseProtocolToast\(\{/);
  assert.match(notifications, /toastXml: protocolToast/);
  assert.match(notifications, /keepAfterTimedOutClose: process.platform === "win32"/);
  assert.match(notifications, /options.openAgent\(agent, "notification-click"\)/);
  assert.match(notifications, /trackNotification\(notification\)/);
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
  // Each brand has its own toast activators, so with two brands on one PC a notification starts
  // the app it came from. The app and the installer take them from the brand.
  const { desktop, cliCommand, homeDir } = appliedBrand();
  const ids = source("packages/desktop/src/features/woowtech-app-user-model-id.ts");
  assert.match(ids, /WOOWTECH_TOAST_ACTIVATOR_CLSID = WINDOWS_TOAST_ACTIVATOR_CLSID;/);
  assert.match(ids, /WOOWTECH_DEV_TOAST_ACTIVATOR_CLSID = WINDOWS_DEV_TOAST_ACTIVATOR_CLSID;/);
  assert.equal(define("WOOWTECH_TOAST_CLSID"), desktop.windowsToastActivatorClsid);
  assert.ok(!nsh.includes(desktop.windowsDevToastActivatorClsid), "the dev runs' CLSID stays");
  const builder = source("packages/desktop/electron-builder.yml");
  assert.equal(define("WOOWTECH_SCHEME"), builder.match(/schemes:\s*\n\s*- (\S+)/)[1]);
  // electron-updater names its cache after the sanitized package name, lower-cased.
  const packageName = builder.match(/extraMetadata:\s*\n\s*name: (\S+)/)[1];
  assert.equal(define("WOOWTECH_UPDATER_CACHE"), `${packageName.toLowerCase()}-updater`);
  // ${APP_ID} names Windows' notification settings key, which belongs to the AUMID.
  assert.equal(builder.match(/^appId: (\S+)$/m)[1], appliedBrand().desktop.appId);
  assert.match(ids, /WOOWTECH_DESKTOP_APP_ID = DESKTOP_APP_ID;/);
  // Install CLI writes the trampoline whose second line the uninstaller checks (G16). The marker
  // names the brand's CLI command, so another brand's release tree ships its own name.
  const shim = source("packages/desktop/src/integrations/cli-install/woowtech-windows-cli-shim.ts");
  assert.match(shim, /export const WINDOWS_CLI_MARKER = `rem \$\{CLI_COMMAND\} CLI trampoline`;/);
  assert.equal(define("WOOWTECH_CLI_MARKER"), `rem ${cliCommand} CLI trampoline`);
  assert.equal(define("WOOWTECH_CLI_COMMAND"), cliCommand);
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
  assert.match(uninstall, /StrCpy \$0 "\$PROFILE\\\.local\\bin\\\$\{WOOWTECH_CLI_COMMAND\}\.cmd"/);
  // User data stays, like moving the Mac app to the Trash (D15).
  assert.doesNotMatch(uninstall, /\$APPDATA|\.local\\bin"/);
  const home = homeDir.replace(/^~\//, "");
  assert.ok(!uninstall.includes(home), `the uninstaller keeps %USERPROFILE%\\${home}`);
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
  // The signature names the applied brand's app and website.
  assert.match(
    hook,
    /"--name",\s*brand\.name,\s*"--url",\s*`https:\/\/\$\{brand\.links\.websiteHost\}`,/,
  );

  // The signature check lets through both names Microsoft signs its own files with in an Electron
  // app: conpty.dll and OpenConsole.exe are "Microsoft Corporation", d3dcompiler_47.dll and
  // dxil.dll are "Microsoft Windows" (found by the signing rehearsal of 2026-11-06).
  const signatures = source("packages/desktop/scripts/woowtech-windows-signatures.ps1");
  assert.match(signatures, /\$signers = @\('Microsoft Corporation', 'Microsoft Windows'\)/);

  const release = source(".github/workflows/desktop-release.yml");
  const windowsJob = release.slice(
    release.indexOf("\n  publish-windows:"),
    release.indexOf("\n  finalize-rollout:"),
  );
  assert.match(windowsJob, /build_args=\(-- --publish never --win --x64\)/);
  assert.doesNotMatch(windowsJob, /--arm64/, "v1 is x64 only (plan §4.9)");
  assert.match(windowsJob, /WOOWTECH_SIGN: "1"/);
  for (const name of ["ESIGNER_STOREPASS", "ESIGNER_CREDENTIAL_ID", "ESIGNER_TOTP_SECRET"]) {
    assert.match(windowsJob, new RegExp(`${name}: \\$\\{\\{ secrets\\.${name} \\}\\}`));
  }
  assert.match(
    windowsJob,
    /jsign-7\.5\.jar' -OutFile \$jar\n[\s\S]*?if \(\$hash -ne '[0-9a-f]{64}'\)/,
  );
  assert.match(windowsJob, /"-c\.win\.signtoolOptions\.publisherName=\$WIN_PUBLISHER_DN"/);
  // Built files, then the installed app with its uninstaller, must all be signed.
  assert.match(windowsJob, /& \$check -Path \$release -RequireSigned -Publisher \$publisher/);
  assert.match(windowsJob, /& \$check -Path \$dir -RequireSigned -Publisher \$publisher/);
});

test("the Windows release job checks the brand it built by that brand's names", () => {
  // Another brand's Windows app is built from a release tree with that brand applied, given as
  // checkout_ref (woowtech/README.md §31). The job finds its installer and installed app by the
  // tree's names, and leaves its files to that brand's own releases repository.
  const release = YAML.parse(source(".github/workflows/desktop-release.yml"));
  const steps = release.jobs["publish-windows"].steps;
  const step = (name) => steps.find((candidate) => candidate.name === name);
  const check = step("Check signatures, install and uninstall");
  assert.match(check.run, /require\('\.\/woowtech\/brands\/index\.cjs'\)\.appliedBrand\(\)/);
  assert.doesNotMatch(check.run, /woowtech smart|woowtech-smart/);
  const upload = step("Upload desktop artifacts to release");
  assert.match(
    upload.run,
    /brand="\$\(node -p "require\('\.\/woowtech\/brands\/index\.cjs'\)\.appliedBrandId\(\)"\)"\nif \[\[ "\$brand" != "woowtech" \]\]; then[\s\S]*?exit 1\nfi/,
  );
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
