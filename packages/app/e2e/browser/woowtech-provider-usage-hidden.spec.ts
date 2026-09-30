import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { installProviderUsageFixture } from "../support/helpers/provider-usage";
import { getServerId } from "../support/helpers/server-id";
import { expectHostPageVisible, expectSettingsHeader } from "../support/helpers/settings";

// woowtech smart: account usage stays hidden (woowtech/README.md section 23). The fixture
// still answers usage requests and advertises the feature, so a request the App sends, or a
// usage block it renders, shows up here.

const USAGE = [
  {
    fetchedAt: "2026-09-29T00:00:00.000Z",
    providers: [
      {
        providerId: "mock",
        displayName: "Mock provider",
        status: "available" as const,
        planLabel: "Test plan",
        windows: [{ id: "session", label: "Session", usedPct: 42 }],
      },
    ],
  },
];

async function openMockAgent(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  const session = await seedMockAgentWorkspace({
    repoPrefix: "provider-usage-hidden-",
    title: "Provider usage hidden e2e",
    initialPrompt: "emit 1 coalesced agent stream update for provider usage hidden.",
  });
  await openAgentRoute(page, session);
  await expectComposerVisible(page);
  await expect(page.getByTestId("context-window-meter")).toBeVisible({ timeout: 30_000 });
  return session;
}

test.describe("account usage hidden", () => {
  test("host settings have no usage row and the usage route opens Connections", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const serverId = getServerId();
    const usageFixture = await installProviderUsageFixture(page, USAGE);

    await gotoAppShell(page);
    await openSettings(page);
    const sidebar = page.getByTestId("settings-sidebar");
    await expect(sidebar.getByTestId("settings-host-section-providers")).toBeVisible();
    await expect(sidebar.getByTestId("settings-host-section-usage")).toHaveCount(0);

    await page.goto(`/settings/hosts/${encodeURIComponent(serverId)}/usage`);
    await expectHostPageVisible(page, serverId);
    await expectSettingsHeader(page, "Connections");
    await expect(page.getByTestId("provider-usage-card")).toHaveCount(0);
    expect(usageFixture.requestCount()).toBe(0);
  });

  test("the context tooltip shows the session's context without asking for usage", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const usageFixture = await installProviderUsageFixture(page, USAGE);
    const session = await openMockAgent(page);
    try {
      await page.getByTestId("context-window-meter").hover();
      await expect(page.getByText("Context window", { exact: true })).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByText("Mock provider", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Loading plan usage…", { exact: true })).toHaveCount(0);
      expect(usageFixture.requestCount()).toBe(0);
    } finally {
      await session.cleanup();
    }
  });
});
