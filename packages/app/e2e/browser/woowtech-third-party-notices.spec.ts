import { expect, test } from "../support/fixtures";

// woowtech smart: Settings > Trademarks and third-party notices (woowtech/README.md sections 24
// and 25). JetBrains asks every use of its brand assets to link back to www.jetbrains.com, so the
// Junie row carries that link, and opening it takes the user to JetBrains' site. The site is
// answered locally: the test never leaves the machine.

const JETBRAINS = "https://www.jetbrains.com/";

test("opens JetBrains' site from the Junie row of the notices page", async ({
  page,
  context,
}, testInfo) => {
  await context.route(`${JETBRAINS}**`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>JetBrains</title>" }),
  );
  await page.goto("/settings/notices");

  const junie = page.getByTestId("third-party-notice-junie");
  await expect(junie).toBeVisible({ timeout: 30_000 });
  await expect(junie).toContainText(
    "Copyright © 2026 JetBrains s.r.o. Junie and the Junie logo are trademarks of JetBrains s.r.o.",
  );
  const link = junie.getByRole("link", { name: "Website: https://www.jetbrains.com" });
  await expect(link).toBeVisible();
  await junie.screenshot({ path: testInfo.outputPath("junie-row.png") });

  const opened = context.waitForEvent("page");
  await link.click();
  const site = await opened;
  await site.waitForURL(JETBRAINS);
  expect(site.url()).toBe(JETBRAINS);

  // The rest of the page still reads as it did: only Junie's row links out.
  await expect(page.getByTestId("third-party-notices").getByRole("link")).toHaveCount(1);
});
