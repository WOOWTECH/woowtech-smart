import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { openSettingsSection } from "../support/helpers/settings";

const SETTINGS_KEY = "@paseo:app-settings";

const SIDE_PANE_ROWS = [
  "Clicking a file in the Explorer sidebar",
  "Clicking a change in the Explorer sidebar or a chat",
  "Clicking a file in an agent chat",
  "Clicking a file in a diff",
  "Clicking a subagent in an agent chat",
];
const EXPLORER_FILES = SIDE_PANE_ROWS[0];
const PULL_REQUESTS = "Clicking a pull request in the Explorer sidebar";
// Script URLs can open in the desktop app's own browser, which the web does not have.
const SERVICE_URLS = "Clicking a script's service URL";

function locationButton(page: Page, label: string, destination: string) {
  return page.getByRole("button", { name: `${label}: ${destination}`, exact: true });
}

async function storedOpenLocation(page: Page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    const stored = raw
      ? (JSON.parse(raw) as {
          openInSidePane?: { explorerFiles?: boolean };
          pullRequestOpenLocation?: string;
        })
      : null;
    return {
      explorerFiles: stored?.openInSidePane?.explorerFiles ?? null,
      pullRequests: stored?.pullRequestOpenLocation ?? null,
    };
  }, SETTINGS_KEY);
}

test("the web chooses where files, diffs, subagents and pull requests open", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoAppShell(page);
  await openSettings(page);
  await openSettingsSection(page, "general");

  await test.step("General lists every open location the web can open into", async () => {
    await expect(page.getByText("Open location", { exact: true })).toBeVisible();
    for (const label of SIDE_PANE_ROWS) {
      await expect(locationButton(page, label, "Main panel")).toBeVisible();
    }
    await expect(locationButton(page, PULL_REQUESTS, "Explorer sidebar")).toBeVisible();
    await expect(page.getByText(SERVICE_URLS, { exact: true })).toHaveCount(0);
  });

  await test.step("a changed location is saved and survives a reload", async () => {
    await locationButton(page, EXPLORER_FILES, "Main panel").click();
    await page.getByRole("menuitem", { name: "On the side", exact: true }).click();
    await locationButton(page, PULL_REQUESTS, "Explorer sidebar").click();
    await page.getByRole("menuitem", { name: "Main panel", exact: true }).click();
    await expect
      .poll(() => storedOpenLocation(page))
      .toEqual({ explorerFiles: true, pullRequests: "main" });

    await page.reload();
    await expect(locationButton(page, EXPLORER_FILES, "On the side")).toBeVisible();
    await expect(locationButton(page, PULL_REQUESTS, "Main panel")).toBeVisible();
  });

  await test.step("the phone layout has no side pane, so General leaves the section out", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByText("Default send", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Open location", { exact: true })).toHaveCount(0);
  });
});
