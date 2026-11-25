import { expect, test } from "../support/fixtures";

test("dedicated settings pages open and retain changes", async ({ page }, testInfo) => {
  await page.goto("/settings");
  await expect(page.getByTestId("settings-sidebar")).toBeVisible();

  await page.getByTestId("settings-section-sidebar").click();
  await expect(page.getByTestId("sidebar-nav-section")).toBeVisible();

  await page.getByTestId("settings-section-chat").click();
  const reasoning = page.getByRole("switch", { name: "Always expand reasoning" });
  await expect(reasoning).toBeVisible();
  const before = await reasoning.getAttribute("aria-checked");
  await reasoning.click();
  await expect(reasoning).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
  await page.reload();
  await expect(reasoning).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");

  await page.getByTestId("settings-section-terminal").click();
  const scrollback = page.getByLabel("Terminal scrollback lines");
  await scrollback.fill("12000");
  await scrollback.press("Tab");
  await page.reload();
  await expect(scrollback).toHaveValue("12000");
  await page.screenshot({ path: testInfo.outputPath("settings-terminal.png"), fullPage: true });
});
