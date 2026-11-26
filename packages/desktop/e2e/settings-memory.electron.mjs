import { createWriteStream } from "node:fs";
import { expect } from "@playwright/test";

const GC_ATTEMPTS = 6;
const SETTINGS_PANE_TEST_ID = "settings-detail-pane";
const STRESS_ROUNDS = 4;
// React Native Web's document-level pointer listener can retain its last target.
const MAX_TRANSIENT_DETACHED_PANES = 2;

const SETTINGS_DESTINATIONS = [
  "General",
  "Appearance",
  "Sidebar",
  "Chat",
  "Terminal",
  "Browser",
  "Editor",
  "Files",
  "Shortcuts",
  "Integrations",
  "Notifications",
  "Permissions",
  "Diagnostics",
  "About",
  "Overview",
  "Projects",
  "Connections",
  "Devices",
  "Agents",
  "Agent profiles",
  "Metadata",
  "Voice",
  "Workspaces",
  "Providers",
  "Usage",
  "Terminals",
  "Plugins",
];

export async function runSettingsPersistenceRegression(page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await openSettingsDestination(page, "Terminal");
  const scrollback = page.getByTestId("terminal-scrollback-input");
  const original = await scrollback.inputValue();
  const value = original === "4321" ? "5432" : "4321";
  await scrollback.fill(value);
  await scrollback.blur();
  await openSettingsDestination(page, "Files");
  await page.getByTestId("file-panel-settings").waitFor({ state: "visible" });
  await page.locator('[data-testid="settings-back-to-workspace"]:visible').click();
  await page.waitForFunction(() => !location.pathname.startsWith("/settings"));
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await openSettingsDestination(page, "Terminal");
  assert((await scrollback.inputValue()) === value, "Terminal scrollback did not survive reload");
  await scrollback.fill(original);
  await scrollback.blur();
  await page.locator('[data-testid="settings-back-to-workspace"]:visible').click();
  await page.waitForFunction(() => !location.pathname.startsWith("/settings"));
  return { terminalScrollbackPersisted: true, filesSettingsVisible: true };
}

export async function runShortcutCaptureRegression(page, evaluateMain) {
  const modifier = process.platform === "darwin" ? "meta" : "control";
  const sendKey = (keyCode, modifiers) =>
    evaluateMain(`
    win.focus();
    win.webContents.focus();
    win.webContents.sendInputEvent(${JSON.stringify({ type: "keyDown", keyCode, modifiers })});
    win.webContents.sendInputEvent(${JSON.stringify({ type: "keyUp", keyCode, modifiers })});
  `);
  const zoomMenuEnabled = () =>
    evaluateMain(`
    const menu = process.mainModule.require('electron').Menu.getApplicationMenu();
    return menu.items.find(item => item.label === 'View').submenu.items.find(item => item.label === 'Zoom In').enabled;
  `);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await openSettingsDestination(page, "Shortcuts");
  const row = page.getByText("Show keyboard shortcuts", { exact: true }).locator("..");
  const baseline = await evaluateMain(
    `return { zoom: win.webContents.getZoomLevel(), count: process.mainModule.require('electron').BrowserWindow.getAllWindows().length };`,
  );
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  for (const [key, modifiers] of [
    ["R", [modifier]],
    ["N", [modifier, "shift"]],
    ["-", [modifier]],
  ]) {
    await page.getByTestId("shortcut-actions-show-shortcuts").click();
    await page.getByTestId("shortcut-bind-show-shortcuts").click();
    await expect(row.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
    // The disabled zoom menu confirms the renderer's capture IPC reached the main process.
    await expect.poll(zoomMenuEnabled).toBe(false);
    await sendKey(key, modifiers);
    await expect(row.getByRole("button", { name: "Done", exact: true })).toBeEnabled();
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
    expect(
      await evaluateMain(
        `return { zoom: win.webContents.getZoomLevel(), count: process.mainModule.require('electron').BrowserWindow.getAllWindows().length };`,
      ),
    ).toEqual(baseline);
    await row.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.poll(zoomMenuEnabled).toBe(true);
  }
  await page.locator('[data-testid="settings-back-to-workspace"]:visible').click();
  await page.waitForFunction(() => !location.pathname.startsWith("/settings"));
  const reloaded = page.waitForEvent("domcontentloaded", { timeout: 15_000 });
  await sendKey("R", [modifier]);
  await reloaded;
  await page.getByRole("button", { name: "Settings", exact: true }).waitFor({ state: "visible" });
  expect(await page.evaluate(() => performance.timeOrigin)).not.toBe(timeOrigin);
  return { recorded: ["reload", "new-window", "zoom-out"], menuRestoredAfterCancel: true };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function openSettingsDestination(page, title) {
  const sidebar = page.locator('[data-testid="settings-sidebar"]:visible');
  const button = sidebar.getByRole("button", { name: title, exact: true });
  await button.waitFor({ state: "visible" });
  await button.click();
  await expect(
    page.locator('[data-testid="settings-detail-header-title"]:visible'),
    `Settings destination ${title} at ${page.url()}`,
  ).toHaveText(title, { timeout: 30_000 });
}

async function rotateSettings(page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator('[data-testid="settings-sidebar"]:visible').waitFor({ state: "visible" });

  for (const title of SETTINGS_DESTINATIONS) {
    await openSettingsDestination(page, title);
  }

  await page.locator('[data-testid="settings-back-to-workspace"]:visible').click();
  await page.waitForFunction(() => !location.pathname.startsWith("/settings"));
}

async function countDetachedSettingsPanes(session) {
  const objectGroup = "settings-retention-check";
  try {
    const prototype = await session.send("Runtime.evaluate", {
      expression: "HTMLDivElement.prototype",
      objectGroup,
    });
    const prototypeObjectId = prototype.result.objectId;
    assert(prototypeObjectId, "CDP did not return HTMLDivElement.prototype");

    const objects = await session.send("Runtime.queryObjects", {
      prototypeObjectId,
      objectGroup,
    });
    const objectsId = objects.objects.objectId;
    assert(objectsId, "CDP did not return HTMLDivElement instances");

    const count = await session.send("Runtime.callFunctionOn", {
      objectId: objectsId,
      functionDeclaration: `function () {
        return Array.prototype.reduce.call(this, (total, node) => {
          const isDetachedSettingsPane =
            node instanceof HTMLDivElement &&
            !node.isConnected &&
            node.getAttribute("data-testid") === ${JSON.stringify(SETTINGS_PANE_TEST_ID)};
          return total + (isDetachedSettingsPane ? 1 : 0);
        }, 0);
      }`,
      returnByValue: true,
    });
    assert(
      typeof count.result.value === "number",
      "CDP did not return a detached Settings pane count",
    );
    return count.result.value;
  } finally {
    await session.send("Runtime.releaseObjectGroup", { objectGroup }).catch(() => undefined);
  }
}

async function collectDetachedSettingsPanes(session) {
  let detachedPanes = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < GC_ATTEMPTS; attempt += 1) {
    await session.send("HeapProfiler.collectGarbage");
    detachedPanes = await countDetachedSettingsPanes(session);
    if (detachedPanes === 0) return 0;
  }
  return detachedPanes;
}

async function captureHeapSnapshot(session, outputPath) {
  const output = createWriteStream(outputPath);
  session.on("HeapProfiler.addHeapSnapshotChunk", ({ chunk }) => output.write(chunk));
  await session.send("HeapProfiler.takeHeapSnapshot", {
    reportProgress: false,
    captureNumericValue: true,
    exposeInternals: false,
  });
  await new Promise((resolve, reject) => {
    output.end(resolve);
    output.on("error", reject);
  });
}

export async function runSettingsMemoryRegression(page) {
  const session = await page.context().newCDPSession(page);
  await session.send("HeapProfiler.enable");

  await rotateSettings(page);
  const detachedAfterWarmRound = await collectDetachedSettingsPanes(session);

  for (let round = 0; round < STRESS_ROUNDS; round += 1) {
    await rotateSettings(page);
  }
  const detachedAfterStress = await collectDetachedSettingsPanes(session);
  if (process.env.PASEO_DESKTOP_SETTINGS_HEAP_SNAPSHOT) {
    await captureHeapSnapshot(session, process.env.PASEO_DESKTOP_SETTINGS_HEAP_SNAPSHOT);
  }

  assert(
    detachedAfterWarmRound <= MAX_TRANSIENT_DETACHED_PANES,
    `A warm Settings rotation retained ${detachedAfterWarmRound} detached detail panes`,
  );
  assert(
    detachedAfterStress <= detachedAfterWarmRound,
    `Settings rotations grew detached detail panes from ${detachedAfterWarmRound} to ${detachedAfterStress}`,
  );

  return {
    warmRounds: 1,
    stressRounds: STRESS_ROUNDS,
    detachedAfterWarmRound,
    detachedAfterStress,
  };
}
