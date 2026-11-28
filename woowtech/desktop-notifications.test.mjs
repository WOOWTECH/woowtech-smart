// Merge guards for the small upstream notification seams. Native delivery behavior
// is covered by woowtech-notification-delivery.test.ts with a typed event/timer port;
// renderer click handoff is covered by packages/app/src/notification-open/electron.test.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { importSource } from "./source-modules.mjs";

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
  // woowtech smart: Windows gets its own settings path (README §31, G19).
  assert.match(
    hook,
    /const helpKeys = desktopNotificationHelpKeys\(getDesktopHost\(\)\?\.platform\);/,
  );
  assert.match(hook, /failureMessage: t\(helpKeys.failed\)/);
  assert.match(hook, /unconfirmedMessage: t\(helpKeys.unconfirmed\)/);
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
  // Upstream 0.18 moved suppression and deduplication into deliverAgentAttentionOsNotification;
  // the localized text is what its sendNotification callback hands to the OS.
  assert.match(callback, /deliverAgentAttentionOsNotification\(\{/);
  assert.match(
    callback,
    /sendNotification: \(notification\) =>\s*sendOsNotification\(\s*localizeAgentNotification\(\{\s*notification,\s*reason: params.reason,\s*t: notificationTranslationRef.current,?\s*\}\)/,
  );
  assert.match(callback, /\[queryClient, serverId\]/);
  assert.doesNotMatch(callback, /\[queryClient, serverId, t\]|\[serverId, t\]/);
  assert.match(
    session,
    /const \{ t \} = useTranslation\(\);\s*const notificationTranslationRef = useRef\(t\);\s*notificationTranslationRef.current = t;/,
  );
  const observeEffect = session.slice(session.indexOf("const feeds = client.observeEvents("));
  const dependencies = observeEffect.match(/\}, \[([\s\S]*?)\]\);/);
  assert.ok(dependencies, "observeEvents effect dependencies");
  assert.match(dependencies[1], /\bnotifyAgentAttention\b/);
  assert.doesNotMatch(dependencies[1], /\bt\b|notificationTranslationRef/);

  const notifications = source("packages/app/src/contexts/session-notifications.ts");
  const deliverStart = notifications.indexOf(
    "export function deliverAgentAttentionOsNotification(",
  );
  assert.notEqual(deliverStart, -1);
  const deliver = notifications.slice(
    deliverStart,
    notifications.indexOf("\nexport function ", deliverStart + 1),
  );
  // An error notifies like the other reasons (owner 2026-11-14): no early return for it, only
  // the device's own preference, which upstream turns on by default.
  assert.doesNotMatch(deliver, /reason === "error"/, "a computer must show an agent's error");
  assert.match(
    deliver,
    /shouldDeliverNotification\(input\.preferences, \{\s*kind: "agent",\s*reason: input\.params\.reason,?\s*\}\)/,
  );
  const preferences = source("packages/protocol/src/notification-preferences.ts");
  assert.match(
    preferences,
    /export const DEFAULT_NOTIFICATION_PREFERENCES[\s\S]*?agentError: true,/,
  );
  assert.match(deliver, /if \(!isAwayFromAgent\) \{\s*return false;/);
  assert.match(deliver, /if \(lastNotified && lastNotified >= timestampMs\) \{\s*return false;/);
  assert.match(deliver, /input\.attentionNotified\.set\(input\.params\.agentId, timestampMs\)/);
  assert.match(
    deliver,
    /resolveAgentAttentionNotification\(\{\s*notification: input\.params\.notification,/,
  );
  assert.ok(deliver.indexOf("input.sendNotification(") > deliver.indexOf("if (!notification)"));
  assert.match(
    notifications,
    /return input.notification.data.workspaceId \? input.notification : null/,
  );
  assert.match(notifications, /return buildAgentAttentionNotificationPayload\(/);
});

// woowtech smart (owner 2026-11-28, README section 16): every event notifies by default, as before
// 0.18. Upstream 0.18 turns agent finished and terminal finished off, and nobody upgrading from 0.17
// has saved preferences, so those notices would stop without a word.
test("every notification event is on by default", async () => {
  const { DEFAULT_NOTIFICATION_PREFERENCES, normalizeNotificationPreferences } = await importSource(
    "packages/protocol/src/notification-preferences.ts",
  );
  const everyEvent = {
    agentPermission: true,
    agentError: true,
    agentFinished: true,
    terminalNeedsInput: true,
    terminalFinished: true,
  };
  assert.equal(DEFAULT_NOTIFICATION_PREFERENCES.enabled, true);
  assert.deepEqual(DEFAULT_NOTIFICATION_PREFERENCES.events, everyEvent);
  assert.deepEqual(normalizeNotificationPreferences(undefined).events, everyEvent);
  assert.deepEqual(normalizeNotificationPreferences({ events: {} }).events, everyEvent);
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

test("notification clicks reopen a window and reach the renderer's notification-open router", () => {
  const main = source("packages/desktop/src/features/notifications.ts");
  assert.match(main, /createNotificationClickRouter\(\{/);
  assert.match(main, /void clickRouter\.routeClick\(senderWebContentsId, data\)/);
  assert.match(main, /win.webContents.send\("paseo:event:notification-click", payload\)/);
  assert.match(main, /ipcMain.handle\("woowtech:notification:takePendingClick"/);
  const desktopMain = source("packages/desktop/src/main.ts");
  assert.match(
    desktopMain,
    /registerNotificationHandlers\(\{\s*ensureWindow: \(\) => desktopWindowOwner.restoreWhenActivated\(\),\s*openAgent: receiveAgentTarget,\s*protocolRegistered: \(\) => agentLinkProtocolRegistered,?\s*\}\)/,
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
  const entry = source("packages/app/src/notification-open/source.electron.ts");
  assert.match(
    entry,
    /return createElectronNotificationOpenSource\(\{ getHost: getDesktopHost, web: createWebSource\(\) \}\)/,
  );
  const adapter = source("packages/app/src/notification-open/electron.ts");
  assert.match(adapter, /const subscription = host\?\.events\?\.on\?\.\(\s*"notification-click"/);
  assert.match(adapter, /Promise\.resolve\(subscription\)\s*\.then\(async \(stop\) =>/);
  const subscribe = adapter.indexOf("stopDesktop = stop;");
  const take = adapter.indexOf("await takePendingDesktopNotificationClick(");
  assert.notEqual(subscribe, -1);
  assert.ok(take > subscribe, "pending click is taken only after the click listener exists");
  assert.match(adapter.slice(subscribe, take), /if \(!stop\) return undefined;/);
  assert.match(adapter.slice(take), /if \(data\) deliver\(data\)/);
  assert.match(
    adapter,
    /if \(activeListener\) activeListener\(tap\);\s*else pendingTaps\.push\(tap\);/,
    "a consumed click must survive a renderer router remount",
  );
  assert.match(adapter, /for \(const tap of pendingTaps\.splice\(0\)\) onTap\(tap\)/);
  assert.match(adapter, /stopWeb\(\);\s*stopDesktop\?\.\(\);/);
  const router = source("packages/app/src/notification-open/react/index.tsx");
  assert.match(router, /import \{ createNotificationOpenSource \} from "\.\.\/source"/);
  assert.match(
    router,
    /createNotificationOpenRouter\(\{\s*source: createNotificationOpenSource\(\)/,
  );
  assert.match(router, /useEffect\(\(\) => notificationRouter\.start\(\), \[\]\)/);
  assert.match(
    source("packages/app/src/app/_layout.tsx"),
    /<NotificationOpenRouter startupBlocked=/,
  );
});

test("Windows gets the electron-builder appId as AppUserModelID before the app is ready", async () => {
  const desktopMain = source("packages/desktop/src/main.ts");
  const call = desktopMain.indexOf("applyWindowsAppUserModelId({");
  assert.notEqual(call, -1);
  assert.ok(call < desktopMain.indexOf("await app.whenReady()"));
  assert.match(
    desktopMain,
    /applyWindowsAppUserModelId\(\{\s*platform: process.platform,\s*isPackaged: app.isPackaged,\s*setAppUserModelId: \(id\) => app.setAppUserModelId\(id\),\s*setToastActivatorCLSID: \(clsid\) => app.setToastActivatorCLSID\(clsid\),?\s*\}\)/,
  );
  const helper = source("packages/desktop/src/features/woowtech-app-user-model-id.ts");
  const builder = source("packages/desktop/electron-builder.yml");
  const appId = builder.match(/^appId: (\S+)$/m)?.[1];
  assert.ok(appId);
  assert.ok(helper.includes("WOOWTECH_DESKTOP_APP_ID = DESKTOP_APP_ID;"));
  const { DESKTOP_APP_ID } = await importSource("packages/protocol/src/brand-desktop.ts");
  assert.equal(DESKTOP_APP_ID, appId);
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
