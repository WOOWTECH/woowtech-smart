import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { openSettingsSection } from "../support/helpers/settings";
import { openWhatsNew, release, serveChangelog } from "../support/helpers/changelog";

declare global {
  interface Window {
    __paseoMailtoOpens?: string[];
  }
}

// woowtech smart: the help menu's Discord item opens WoowTech's LINE official account and
// its GitHub item writes to WoowTech support.
const LINE_OFFICIAL_ACCOUNT_DESTINATION =
  /^https:\/\/line\.me\/R\/ti\/p\/(?:@|%40)lwo6431z(?:[/?#]|$)/;
const SUPPORT_EMAIL = "mailto:woowtech@designsmart.com.tw";
const CHANGELOG_DESTINATION =
  /^https:\/\/github\.com\/WOOWTECH\/woowtech-smart-releases\/releases(?:[/?#]|$)/;
// The name and the version are separate cells of a key/value row, so they meet with no space
// between them in the row's text content.
const APP_VERSION = /^woowtech smart\s*v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

async function openHelpMenu(page: Page): Promise<void> {
  await page.getByTestId("sidebar-help").click();
  await expect(page.getByTestId("sidebar-help-menu")).toBeVisible();
}

async function expectDiagnosticReport(page: Page): Promise<void> {
  const sheet = page.getByTestId("app-diagnostic-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Copy diagnostic" })).toBeEnabled();
  await expect(page.getByText(/App version:/).first()).toBeVisible();
}

async function closeSheet(page: Page, testID: string): Promise<void> {
  const sheet = page.getByTestId(testID);
  await sheet.getByLabel("Close").click();
  await expect(sheet).not.toBeVisible();
}

async function expectExternalPage(
  page: Page,
  actionTestID: string,
  expectedUrl: RegExp,
): Promise<void> {
  const popupPromise = page.waitForEvent("popup");
  await page.getByTestId(actionTestID).click();
  const popup = await popupPromise;
  expect(popup.url()).toMatch(expectedUrl);
  await popup.close();
}

// A mailto: link hands the address to the mail client and opens no browser page, so there is
// no popup to wait for. Record the window.open calls the app makes for mailto: links instead.
async function recordMailtoOpens(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const openWindow = window.open.bind(window);
    const mailtoOpens: string[] = [];
    window.__paseoMailtoOpens = mailtoOpens;
    window.open = (url, target, features) => {
      if (String(url).startsWith("mailto:")) {
        mailtoOpens.push(String(url));
        return null;
      }
      return openWindow(url, target, features);
    };
  });
}

async function expectMailtoLink(
  page: Page,
  actionTestID: string,
  expectedUrl: string,
): Promise<void> {
  await page.getByTestId(actionTestID).click();
  await expect
    .poll(() => page.evaluate(() => window.__paseoMailtoOpens?.slice() ?? []))
    .toEqual([expectedUrl]);
}

test("opens troubleshooting and support destinations", async ({ page }) => {
  await recordMailtoOpens(page);
  await gotoAppShell(page);
  await expect(page.getByTestId("sidebar-help")).toBeVisible();

  await test.step("opens diagnostics and keyboard shortcuts", async () => {
    await openHelpMenu(page);
    await expect(page.getByText("Help", { exact: true })).toBeVisible();
    await expect(page.getByText("Report an issue", { exact: true })).toBeVisible();
    await expect(page.getByText("What's new", { exact: true })).toBeVisible();
    await expect(page.getByTestId("sidebar-help-version")).toHaveText(APP_VERSION);

    await page.getByTestId("sidebar-help-diagnostics").click();
    await expectDiagnosticReport(page);
    await closeSheet(page, "app-diagnostic-sheet");

    await openHelpMenu(page);
    await page.getByTestId("sidebar-help-shortcuts").click();
    await expect(page.getByTestId("keyboard-shortcuts-dialog")).toBeVisible();
    await closeSheet(page, "keyboard-shortcuts-dialog");
  });

  await test.step("opens support pages", async () => {
    await openHelpMenu(page);
    await expectExternalPage(page, "sidebar-help-discord", LINE_OFFICIAL_ACCOUNT_DESTINATION);

    await openHelpMenu(page);
    await expectMailtoLink(page, "sidebar-help-github", SUPPORT_EMAIL);
  });
});

test("renders the changelog in the app and links the website", async ({ page }) => {
  // A callout, a section name the app has never seen, and a fenced sample whose
  // contents look like a release heading.
  await serveChangelog(page, [
    "# Changelog",
    "",
    "## 9.1.0 - 2026-03-04",
    "",
    "Headline release note.",
    "",
    "> [!WARNING]",
    "> Read this before upgrading.",
    "",
    "### Sparkles",
    "",
    "- Added a brand new thing",
    "",
    "```md",
    "## 0.0.0 - 1999-01-01",
    "```",
    "",
    "## 9.0.0 - 2026-02-01",
    "",
    "### Fixed",
    "",
    "- Fixed an older thing",
    "",
  ]);
  await gotoAppShell(page);

  const sheet = await openWhatsNew(page);
  const latest = release(sheet, "9.1.0");

  await expect(latest.getByText("March 4, 2026", { exact: true })).toBeVisible();
  await expect(latest.getByText("Headline release note.")).toBeVisible();
  await expect(latest.getByText("Read this before upgrading.")).toBeVisible();
  await expect(latest.getByText("Sparkles", { exact: true })).toBeVisible();
  await expect(latest.getByText("Added a brand new thing")).toBeVisible();
  await expect(release(sheet, "9.0.0")).toBeVisible();
  await expect(release(sheet, "0.0.0")).toHaveCount(0);

  await expectExternalPage(page, "changelog-open-website", CHANGELOG_DESTINATION);
  await closeSheet(page, "changelog-sheet");
});

test("searches keyboard shortcuts from the sidebar help menu", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
  });
  await gotoAppShell(page);
  await openHelpMenu(page);
  await page.getByTestId("sidebar-help-shortcuts").click();

  const dialog = page.getByTestId("keyboard-shortcuts-dialog");
  const search = page.getByPlaceholder("Search shortcuts");

  await search.fill("command+n");
  await expect(dialog.getByText("New workspace", { exact: true })).toBeVisible();

  await search.fill("interrupt");

  await expect(dialog.getByText("Interrupt agent", { exact: true })).toBeVisible();
  await expect(dialog.getByText("New workspace", { exact: true })).toHaveCount(0);

  await search.fill("no matching shortcut");
  await expect(dialog.getByText("No results found", { exact: true })).toBeVisible();

  await search.fill("");
  await expect(dialog.getByText("New workspace", { exact: true })).toBeVisible();
});

test("keeps diagnostics available from Settings after globalizing the sheet", async ({ page }) => {
  await gotoAppShell(page);
  await openSettings(page);
  await openSettingsSection(page, "diagnostics");

  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expectDiagnosticReport(page);
});

test.describe("compact sidebar help", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("offers diagnostics without advertising disabled keyboard shortcuts", async ({ page }) => {
    await gotoAppShell(page);
    await page.getByRole("button", { name: "Open menu", exact: true }).click();

    await openHelpMenu(page);
    await expect(page.getByTestId("sidebar-help-shortcuts")).toHaveCount(0);
    await page.getByTestId("sidebar-help-diagnostics").click();
    await expectDiagnosticReport(page);
  });
});
