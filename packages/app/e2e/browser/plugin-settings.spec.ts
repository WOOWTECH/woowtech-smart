import { expect, test as builtinTest } from "../support/fixtures";
import { openMobileAgentSidebar } from "../support/helpers/sidebar";
import { connectNewWorkspaceDaemonClient } from "../support/helpers/new-workspace";
import { gotoAppShell } from "../support/helpers/app";
import { pluginPageRoute } from "../support/helpers/plugin-gallery";
import { openCommandCenter } from "../support/helpers/command-center";
import {
  test,
  openDisplaySettings,
  openCompactDisplaySettings,
  groupByWorkspace,
  hideMetadata,
  reloadSavedDisplaySettings,
  editTitle,
  replaceTitle,
  saveTitle,
  expectTitleRequired,
  expectSavedTitle,
  changeMetadataFromAnotherClient,
  expectConflictPreservesDraft,
  discardTitle,
  returnAndReopenSettings,
  returnToPluginsPage,
  expectSettingsUnavailable,
  openPluginsPage,
  expectActionsMenuWithoutSettings,
  expectSettingsFollowPluginSwitch,
  expectSettingsHidden,
  expectSettingsTab,
  openTabbedSettings,
  selectSettingsTab,
  openTabbedSettingsLink,
  expectNamedPluginRow,
} from "../support/helpers/plugin-settings";

test("display preferences survive a reload", async ({ page }) => {
  await openDisplaySettings(page);
  await groupByWorkspace(page);
  await hideMetadata(page);
  await reloadSavedDisplaySettings(page);
});

test("invalid titles stay editable until a valid title is saved", async ({ page }) => {
  await openDisplaySettings(page);
  await editTitle(page, "");
  await saveTitle(page);
  await expectTitleRequired(page);
  await replaceTitle(page, "My monitor");
  await saveTitle(page);
  await expectSavedTitle(page, "My monitor");
});

test("another client's save preserves a conflicting draft", async ({ page }) => {
  await openDisplaySettings(page);
  await editTitle(page, "Unsaved title");
  await changeMetadataFromAnotherClient(page);
  await saveTitle(page);
  await expectConflictPreservesDraft(page, "Unsaved title");
  await discardTitle(page);
});

test("Back to plugins returns from a plugin page", async ({ page }) => {
  await openDisplaySettings(page);
  await returnToPluginsPage(page);
});

test("plugin pages open from their row and show a tab per settings screen", async ({ page }) => {
  await openPluginsPage(page);
  await test.step("plugin rows show the display name", async () => {
    await expectNamedPluginRow(page);
  });
  await test.step("the row opens the plugin's page", async () => {
    await openTabbedSettings(page);
  });
  await test.step("the page's menu keeps only plugin actions", async () => {
    await expectActionsMenuWithoutSettings(page);
  });
  await test.step("tabs switch between the plugin's settings screens", async () => {
    await selectSettingsTab(page, "Advanced");
    await selectSettingsTab(page, "General");
    await returnToPluginsPage(page);
  });
  await test.step("turning a plugin off removes its settings from its page", async () => {
    await expectSettingsFollowPluginSwitch(page);
  });
});

test("a settings screen link opens its tab, unavailable while the plugin is off", async ({
  page,
  settingsPlugin,
}) => {
  await openTabbedSettingsLink(page, "Advanced");
  await settingsPlugin.disablePlugin("settings-tabs");
  await expectSettingsUnavailable(page);
  await settingsPlugin.enablePlugin("settings-tabs");
  await expectSettingsTab(page, "Advanced");
});

test.describe("compact plugin settings", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Back and plugin re-enable restore the settings screen", async ({
    page,
    settingsPlugin,
  }) => {
    await openCompactDisplaySettings(page);
    await groupByWorkspace(page);
    await hideMetadata(page);
    await returnAndReopenSettings(page);
    await settingsPlugin.disablePlugin("settings-example");
    await expectSettingsHidden(page);
    await settingsPlugin.enablePlugin("settings-example");
    await reloadSavedDisplaySettings(page);
  });
});

for (const { width, boardReadyTestId } of [
  { width: 1440, boardReadyTestId: "lane-header-done" },
  { width: 390, boardReadyTestId: "phone-stat-done" },
]) {
  builtinTest.describe(`built-in plugin settings at ${width}px`, () => {
    builtinTest.setTimeout(120_000);
    builtinTest.use({ viewport: { width, height: 900 } });
    builtinTest(
      "opens runtime settings without exposing installation controls",
      async ({ page }) => {
        const client = await connectNewWorkspaceDaemonClient({ ownProjects: false });
        try {
          expect((await client.listPlugins()).map((plugin) => plugin.id)).not.toContain(
            "better-paseo",
          );
          expect((await client.getPluginCatalog()).map((plugin) => plugin.id)).toContain(
            "better-paseo",
          );
        } finally {
          await client.close();
        }
        await gotoAppShell(page);
        await page.goto(`${pluginPageRoute("better-paseo")}/chat-presentation`);
        await expect(
          page.getByRole("radio", { name: "Chat presentation", exact: true }),
        ).toBeVisible();
        await expect(page.getByRole("radio", { name: "Tasks board", exact: true })).toBeVisible();
        await expect(page.getByRole("radio", { name: /^Version(?:,|$)/ })).toBeVisible();
        await page.getByRole("radio", { name: "Tasks board", exact: true }).click();
        await expect(page.getByTestId("tasks-settings-panel")).toBeVisible();
        await expect(page.getByTestId("plugin-update")).toHaveCount(0);
        await expect(page.getByRole("switch", { name: /Better Paseo:.*[Dd]isable/ })).toHaveCount(
          0,
        );
        await page.reload();
        await expect(
          page.getByRole("radio", { name: "Chat presentation", exact: true }),
        ).toBeVisible();
        await page.goto("/new");
        if (width === 390) await openMobileAgentSidebar(page);
        await openCommandCenter(page);
        const panel = page.getByTestId("command-center-panel");
        await panel.getByTestId("command-center-input").fill("Open Tasks");
        await panel.getByText("Open Tasks", { exact: true }).click();
        await expect(page).toHaveURL(/\/plugin\/better-paseo\/surface\/tasks/);
        await expect(page.getByTestId(boardReadyTestId)).toBeVisible();
      },
    );
  });
}
