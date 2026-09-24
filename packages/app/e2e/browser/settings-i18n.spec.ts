import { test, expect } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { openSettingsSection } from "../support/helpers/settings";

test("Settings language selector switches General labels", async ({ page }) => {
  test.setTimeout(120_000);

  await gotoAppShell(page);
  await openSettings(page);
  await openSettingsSection(page, "general");

  await expect(page.getByText("Default send", { exact: true }).first()).toBeVisible();

  // woowtech smart offers Traditional Chinese in place of upstream's Simplified Chinese.
  await page.getByRole("button", { name: "System", exact: true }).click();
  await page.getByRole("menuitem", { name: "繁體中文 - Traditional Chinese", exact: true }).click();

  await expect(page.getByText("預設傳送", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "繁體中文", exact: true }).click();
  await page.getByRole("menuitem", { name: "English - 英文", exact: true }).click();

  await expect(page.getByText("Default send", { exact: true }).first()).toBeVisible();
});

test("Settings language selector switches to Korean", async ({ page }) => {
  test.setTimeout(120_000);

  await gotoAppShell(page);
  await openSettings(page);
  await openSettingsSection(page, "general");

  await page.getByRole("button", { name: "System", exact: true }).click();
  await page.getByRole("menuitem", { name: "한국어 - Korean", exact: true }).click();

  await expect(page.getByText("기본 전송", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "한국어", exact: true }).click();
  await page.getByRole("menuitem", { name: "English - 영어", exact: true }).click();

  await expect(page.getByText("Default send", { exact: true }).first()).toBeVisible();
});
