import { version as appVersion } from "../../package.json";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { BUILTIN_PROVIDER_IDS } from "@getpaseo/protocol/provider-manifest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test as base, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";

type BuiltinClient = Pick<
  DaemonClient,
  | "connect"
  | "close"
  | "getDaemonConfig"
  | "getLastServerInfoMessage"
  | "getPluginCatalog"
  | "invokePluginRpc"
  | "listUsageReports"
>;

const test = base.extend({
  e2eDaemonEnvironment: [
    async ({ browserName: _browserName }, provide) => {
      const credentialsHome = await mkdtemp(path.join(tmpdir(), "builtin-tasks-credentials-"));
      // The worker's PASEO_HOME isolates daemon state, but its inherited HOME
      // and provider environment otherwise expose the runner's real accounts.
      const clearedCredentials = Object.fromEntries(
        Object.keys(process.env)
          .filter((key) => /TOKEN|SECRET|PASSWORD|API_KEY|AUTH|CREDENTIAL/i.test(key))
          .map((key) => [key, ""]),
      );
      try {
        await provide({
          ...clearedCredentials,
          HOME: credentialsHome,
          USERPROFILE: credentialsHome,
          CODEX_HOME: credentialsHome,
          CLAUDE_CONFIG_DIR: credentialsHome,
          XDG_CONFIG_HOME: credentialsHome,
          XDG_DATA_HOME: credentialsHome,
          XDG_CACHE_HOME: credentialsHome,
          APPDATA: credentialsHome,
          LOCALAPPDATA: credentialsHome,
          PI_CODING_AGENT_DIR: credentialsHome,
          PI_CONFIG_DIR: credentialsHome,
          GH_CONFIG_DIR: credentialsHome,
          KIMI_CODE_HOME: credentialsHome,
          OPENCODE_CONFIG_DIR: credentialsHome,
          OPENCODE_CONFIG: "",
          OPENCODE_CONFIG_CONTENT: "",
        });
      } finally {
        await rm(credentialsHome, { recursive: true, force: true });
      }
    },
    { scope: "worker" },
  ],
});

const disabledProviders = Object.fromEntries(
  [...BUILTIN_PROVIDER_IDS, "antigravity", "fx", "goose", "hermes", "hoplite", "muse"].map(
    (provider) => [provider, { enabled: false }],
  ),
);

// The normal worker starts the real daemon, including its builtin loader.
// The plugin-directory/versioned-host fixture deliberately disables builtins.
// No source install, provider session, or plugin settings write is needed here.
test.use({
  locale: "zh-TW",
  viewport: { width: 1440, height: 1000 },
  e2eDaemonConfig: {
    version: 1,
    pluginsEnabled: false,
    plugins: {},
    daemon: { relay: { enabled: false }, usage: { enabled: false } },
    agents: { providers: disabledProviders, resumeOnStartup: false },
  },
});

async function readBuiltinDefaults(client: BuiltinClient) {
  const tasks = await client.invokePluginRpc("better-paseo", "settings.tasks.read", {});
  const presentation = await client.invokePluginRpc(
    "better-paseo",
    "settings.presentation.read",
    {},
  );
  expect(tasks).toMatchObject({ status: "ready", values: { enabled: true } });
  expect(presentation).toMatchObject({
    status: "ready",
    values: { chatEnabled: false, autoUpdateCheck: false, language: "system" },
  });
  return { tasks, presentation };
}

async function expectEmptyBoard(page: Page) {
  // These belong to the lazy board chunk, not its sidebar/loading placeholder.
  await expect(page.getByTestId("desktop-toolbar")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("還沒有任務", { exact: true })).toBeVisible();
  await expect(page.getByTestId("task-card-title")).toHaveCount(0);
}

test("builtin Tasks opens by default in zh-TW with chat enhancement off and survives reload", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const client = await connectDaemonClient<BuiltinClient>({ clientIdPrefix: "builtin-tasks" });
  try {
    await test.step("The updated host serves the builtin while user plugins are disabled", async () => {
      expect(client.getLastServerInfoMessage()).toMatchObject({ version: appVersion });
      expect(await client.getDaemonConfig()).toMatchObject({
        config: {
          pluginsEnabled: false,
          plugins: {},
          usage: { enabled: false },
          providers: disabledProviders,
        },
      });
      // Exercise the real server gate: even an explicit refresh must stop before
      // credential discovery or a provider's usage endpoint is called.
      await expect(client.listUsageReports({ forceRefresh: true })).rejects.toThrow(
        "Usage is off on this host.",
      );
      const catalog = await client.getPluginCatalog();
      expect(catalog.find((plugin) => plugin.id === "better-paseo")).toMatchObject({
        id: "better-paseo",
        clientBundle: expect.stringMatching(/\S/),
      });
      const { tasks, presentation } = await readBuiltinDefaults(client);
      // A saved enabled value would not prove the first-install default.
      expect(tasks).toMatchObject({ revision: "missing" });
      expect(presentation).toMatchObject({ revision: "missing" });
    });

    const entry = page.getByTestId("plugin-sidebar-better-paseo-tasks");
    await test.step("The default sidebar entry opens the actual translated board", async () => {
      await gotoAppShell(page);
      await expect(entry).toBeVisible({ timeout: 30_000 });
      await expect(entry).toHaveAccessibleName("任務");
      await entry.click();
      await expectEmptyBoard(page);
    });

    await test.step("Reload restores the board and keeps the original defaults", async () => {
      await page.reload();
      await expect(entry).toBeVisible({ timeout: 30_000 });
      await expect(entry).toHaveAccessibleName("任務");
      await expectEmptyBoard(page);
      await readBuiltinDefaults(client);
      expect(await client.getDaemonConfig()).toMatchObject({
        config: { pluginsEnabled: false, usage: { enabled: false } },
      });
    });

    await test.step("Desktop time range exposes exactly one checked segment after each tap", async () => {
      const segments = page.getByTestId("done-window").locator('[role="radio"]');
      const count = await segments.count();
      expect(count).toBeGreaterThan(1);
      for (let index = 0; index < count; index += 1) {
        await segments.nth(index).click();
        await expect(segments.nth(index)).toHaveAttribute("aria-checked", "true");
        await expect(
          page.getByTestId("done-window").locator('[role="radio"][aria-checked="true"]'),
        ).toHaveCount(1);
        await expect(
          page.getByTestId("done-window").locator('[role="radio"][aria-checked="false"]'),
        ).toHaveCount(count - 1);
      }
    });

    await test.step("Phone tabs expose exactly one selected lane and update after each tap", async () => {
      await page.setViewportSize({ width: 390, height: 900 });
      const tabs = page.locator('[data-testid^="phone-stat-"]');
      await expect(tabs).toHaveCount(5);
      for (const lane of ["needs_input", "running", "review", "done", "archived"]) {
        const tab = page.getByTestId(`phone-stat-${lane}`);
        await expect(tab).toHaveAttribute("role", "tab");
        await tab.click();
        await expect(tab).toHaveAttribute("aria-selected", "true");
        await expect(
          page.locator('[data-testid^="phone-stat-"][aria-selected="true"]'),
        ).toHaveCount(1);
        await expect(
          page.locator('[data-testid^="phone-stat-"][aria-selected="false"]'),
        ).toHaveCount(4);
      }
      await page.reload();
      await expect(page.locator('[data-testid^="phone-stat-"][aria-selected="true"]')).toHaveCount(
        1,
      );
      await page.setViewportSize({ width: 1440, height: 1000 });
      await expectEmptyBoard(page);
      await readBuiltinDefaults(client);
    });
  } finally {
    await client.close();
  }
});
