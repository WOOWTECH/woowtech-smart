// Merge guards for the small upstream notification seams. Native delivery behavior
// is covered by woowtech-notification-delivery.test.ts with a typed event/timer port.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("desktop IPC waits for native delivery and retains click routing", () => {
  const main = source("packages/desktop/src/features/notifications.ts");
  assert.match(main, /return showNotificationWithDelivery\(\{/);
  assert.match(main, /release: \(\) => \{\s*activeNotifications.delete\(notification\)/);
  assert.match(main, /win.webContents.send\("paseo:event:notification-click", payload\)/);
  assert.doesNotMatch(main, /notification.show\(\);\s*return true/);
  assert.match(main, /notification: probe,\s*closeOnTimeout: true/);
  const regularSend = main.slice(main.indexOf("async function sendWithResult"));
  assert.doesNotMatch(regularSend, /closeOnTimeout/);
  assert.match(main, /return \(await sendWithResult\(event, rawInput\)\) === "shown"/);
  assert.match(main, /ipcMain.handle\("woowtech:notification:sendWithResult", sendWithResult\)/);
  const preload = source("packages/desktop/src/preload.ts");
  assert.match(
    preload,
    /sendNotificationWithResult:[\s\S]*?ipcRenderer.invoke\("woowtech:notification:sendWithResult", payload\)/,
  );
  assert.match(
    preload,
    /sendNotification:[\s\S]*?ipcRenderer.invoke\("paseo:notification:send", payload\)/,
  );
  const osNotifications = source("packages/app/src/utils/os-notifications.ts");
  assert.match(osNotifications, /return await desktopNotificationSender\(payload\)/);
});

test("renderer uses unknown permission, test policy and visible translated result feedback", () => {
  const permission = source("packages/app/src/desktop/permissions/desktop-permissions.ts");
  assert.match(permission, /state: supported \? "unknown" : "unavailable"/);
  const section = source("packages/app/src/desktop/components/desktop-notifications-section.tsx");
  assert.match(section, /canTestNotification\(snapshot\?\.notifications.state\)/);
  assert.match(
    section,
    /disabled=\{!notificationsTestable \|\| isPermissionBusy \|\| isSendingTestNotification\}/,
  );
  for (const key of [
    "testHint",
    "send",
    "successTitle",
    "successDescription",
    "failedTitle",
    "unconfirmedTitle",
  ]) {
    assert.ok(section.includes(`t("woowtech.desktopNotifications.${key}")`), key);
  }
  assert.match(section, /description=\{testNotificationState.message\}/);
  assert.match(
    section,
    /testNotificationState.status === "unconfirmed"[\s\S]*?variant="warning"[\s\S]*?testID="desktop-notifications-test-unconfirmed"/,
  );
  assert.match(section, /testNotificationState.status === "error"[\s\S]*?variant="error"/);
  assert.match(section, /testNotificationState.status === "success"[\s\S]*?variant="success"/);
  const hook = source("packages/app/src/desktop/permissions/use-desktop-permissions.ts");
  assert.match(hook, /await runNotificationTest\(\{/);
  assert.match(hook, /failureMessage: t\("woowtech.desktopNotifications.failed"\)/);
  assert.match(hook, /unconfirmedMessage: t\("woowtech.desktopNotifications.unconfirmed"\)/);
  assert.match(
    hook,
    /sendDesktopTestNotification\(\{\s*bridge: getDesktopHost\(\)\?\.notification,/,
  );
  assert.match(hook, /if \(!isDesktopApp \|\| testNotificationPendingRef.current\)/);
  assert.match(hook, /if \(isMountedRef.current\) setTestNotificationState\(state\)/);
});

test("agent notification caller localizes after existing suppression and deduplication", () => {
  const session = source("packages/app/src/contexts/session-context.tsx");
  const start = session.indexOf("const notifyAgentAttention = useCallback(");
  assert.notEqual(start, -1);
  const callback = session.slice(start, session.indexOf("\n  useEffect(", start));
  assert.match(
    callback,
    /sendOsNotification\(\s*localizeAgentNotification\(\{\s*notification,\s*reason: params.reason,\s*t: notificationTranslationRef.current,?\s*\}\)/,
  );
  assert.match(callback, /\[serverId\]/);
  assert.doesNotMatch(callback, /\[serverId, t\]/);
  assert.match(
    session,
    /const \{ t \} = useTranslation\(\);\s*const notificationTranslationRef = useRef\(t\);\s*notificationTranslationRef.current = t;/,
  );
  const observeEffect = session.slice(session.indexOf("const feeds = client.observeEvents("));
  const dependencies = observeEffect.match(/\}, \[([\s\S]*?)\]\);/);
  assert.ok(dependencies, "observeEvents effect dependencies");
  assert.match(dependencies[1], /\bnotifyAgentAttention\b/);
  assert.doesNotMatch(dependencies[1], /\bt\b|notificationTranslationRef/);
  assert.match(callback, /if \(params.reason === "error"\) \{\s*return;/);
  assert.match(callback, /if \(!isAwayFromAgent\) \{\s*return;/);
  assert.match(callback, /if \(lastNotified && lastNotified >= timestampMs\) \{\s*return;/);
  assert.match(callback, /attentionNotifiedRef.current.set\(params.agentId, timestampMs\)/);
  assert.match(
    callback,
    /resolveAgentAttentionNotification\(\{\s*notification: params.notification,/,
  );
  assert.ok(
    callback.indexOf("localizeAgentNotification(") > callback.indexOf("if (!notification)"),
  );
  assert.match(session, /return input.notification.data.workspaceId \? input.notification : null/);
  assert.match(session, /return buildAgentAttentionNotificationPayload\(/);
});

test("renderer owns its delivery result union and agrees with Electron without sibling src imports", () => {
  const renderer = source("packages/app/src/desktop/host.ts");
  const desktop = source("packages/desktop/src/features/woowtech-notification-delivery.ts");
  const union = /export type NotificationDeliveryResult = ([^;]+);/;
  assert.doesNotMatch(renderer, /(?:import|export)[^;]*desktop\/src\//);
  const values = (text) => {
    const declaration = text.match(union);
    assert.ok(declaration, "explicit local delivery result union");
    return declaration[1]
      .split("|")
      .map((member) => {
        const literal = member.trim();
        assert.match(literal, /^"[^"]+"$/);
        return literal.slice(1, -1);
      })
      .sort();
  };
  assert.deepEqual(values(renderer), ["failed", "shown", "unconfirmed"]);
  assert.deepEqual(values(renderer), values(desktop));
});

test("notification icon ships with every packaged desktop and is resolved from resources", () => {
  const main = source("packages/desktop/src/features/notifications.ts");
  assert.doesNotMatch(main, /path\.resolve\(__dirname, "\.\.\/assets\//);
  assert.match(
    main,
    /notificationIconCandidates\(\{\s*platform: process.platform,\s*isPackaged: app.isPackaged,\s*resourcesPath: process.resourcesPath,\s*moduleDir: __dirname,?\s*\}\)/,
  );
  // macOS banners already show the app icon; an explicit icon would be drawn again as a content image.
  const iconModule = source("packages/desktop/src/features/woowtech-notification-icon.ts");
  assert.match(iconModule, /if \(input\.platform === "darwin"\) \{\s*return \[\];\s*\}/);
  const builder = source("packages/desktop/electron-builder.yml");
  for (const platform of ["mac", "linux", "win"]) {
    const start = builder.search(new RegExp(`^${platform}:$`, "m"));
    assert.notEqual(start, -1, platform);
    const rest = builder.slice(builder.indexOf("\n", start) + 1);
    const end = rest.search(/^\S/m);
    const block = end === -1 ? rest : rest.slice(0, end);
    assert.match(
      block,
      /- from: assets\/icon\.png\n\s+to: icon\.png/,
      `${platform} ships icon.png`,
    );
  }
});

test("notification clicks reopen a window and wait for the renderer's PushNotificationRouter", () => {
  const main = source("packages/desktop/src/features/notifications.ts");
  assert.match(main, /createNotificationClickRouter\(\{/);
  assert.match(main, /void clickRouter\.routeClick\(senderWebContentsId, data\)/);
  assert.match(main, /win.webContents.send\("paseo:event:notification-click", payload\)/);
  assert.match(main, /ipcMain.handle\("woowtech:notification:takePendingClick"/);
  const desktopMain = source("packages/desktop/src/main.ts");
  assert.match(
    desktopMain,
    /registerNotificationHandlers\(\{\s*ensureWindow: \(\) => desktopWindowOwner.restoreWhenActivated\(\),?\s*\}\)/,
  );
  const owner = source("packages/desktop/src/window/desktop-window-owner.ts");
  assert.match(owner, /restoreCreation/);
  const preload = source("packages/desktop/src/preload.ts");
  assert.match(
    preload,
    /takePendingClick:[\s\S]*?ipcRenderer.invoke\("woowtech:notification:takePendingClick"\)/,
  );
  const host = source("packages/app/src/desktop/host.ts");
  assert.match(host, /takePendingClick\?: \(\) => Promise</);
  const layout = source("packages/app/src/app/_layout.tsx");
  const router = layout.slice(layout.indexOf("function PushNotificationRouter()"));
  const subscribe = router.indexOf("removeDesktopNotificationListener = unlisten;");
  const take = router.indexOf("takePendingDesktopNotificationClick(");
  assert.notEqual(subscribe, -1);
  assert.ok(take > subscribe, "pending click is taken only after the click listener exists");
  assert.match(router.slice(take), /openNotification\(data\)/);
});

test("Windows gets the electron-builder appId as AppUserModelID before the app is ready", () => {
  const desktopMain = source("packages/desktop/src/main.ts");
  const call = desktopMain.indexOf("applyWindowsAppUserModelId({");
  assert.notEqual(call, -1);
  assert.ok(call < desktopMain.indexOf("await app.whenReady()"));
  assert.match(
    desktopMain,
    /applyWindowsAppUserModelId\(\{\s*platform: process.platform,\s*isPackaged: app.isPackaged,\s*execPath: process.execPath,\s*setAppUserModelId: \(id\) => app.setAppUserModelId\(id\),?\s*\}\)/,
  );
  const helper = source("packages/desktop/src/features/woowtech-app-user-model-id.ts");
  const builder = source("packages/desktop/electron-builder.yml");
  const appId = builder.match(/^appId: (\S+)$/m)?.[1];
  assert.ok(appId);
  assert.ok(helper.includes(`WOOWTECH_DESKTOP_APP_ID = "${appId}"`));
});

// woowtech smart (README section 16): macOS keeps a new app's notifications hidden until the person
// answers its first-launch prompt, and still reports them shown, so the desktop asks the person.
test("the desktop asks whether the banner showed, in Settings and once in the sidebar", () => {
  assert.match(
    source("packages/app/src/app/_layout.tsx"),
    /<NotificationBannerCheckCalloutSource \/>/,
  );
  const section = source("packages/app/src/desktop/components/desktop-notifications-section.tsx");
  assert.match(
    section,
    /<NotificationBannerCheckPrompt onTestAgain=\{handleSendTestNotification\} \/>/,
  );
  assert.match(section, /void loadBannerCheck\(\);/);
  const permissions = source("packages/app/src/desktop/permissions/use-desktop-permissions.ts");
  assert.match(permissions, /if \(state\.status === "success"\) askAboutBanner\(\);/);
  assert.match(
    permissions,
    /if \(state\.status === "error" \|\| state\.status === "unconfirmed"\) showBannerHelp\(\);/,
  );
  const callout = source(
    "packages/app/src/desktop/woowtech-notification-banner-check-callout-source.tsx",
  );
  assert.match(callout, /if \(!isElectron \|\| !loaded \|\| confirmed\) \{/);
  assert.match(callout, /dismissalKey: CALLOUT_ID,/, "closing the callout keeps it closed");
});
