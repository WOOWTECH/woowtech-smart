import { describe, expect, test } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import type { AgentClient, AgentModelDefinition } from "./agent-sdk-types.js";
import { buildProviderRegistry } from "./provider-registry.js";
import { ProviderSnapshotManager } from "./provider-snapshot-manager.js";

// woowtech smart: the login state in provider snapshots is display only (woowtech/README.md §3).

const CAPABILITIES = {
  supportsStreaming: false,
  supportsSessionPersistence: false,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
} as const;
const MODELS: AgentModelDefinition[] = [
  { provider: "claude", id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", isDefault: true },
];
const EMAIL = "fake-owner@example.invalid";
const TOKEN = "sk-ant-oat01-fakeTokenForTestsOnly-000000000000000000";
// A derived provider's own env must decide, whatever the machine running the test has set.
const NO_CLOUD_PROVIDER = {
  CLAUDE_CODE_USE_BEDROCK: "",
  CLAUDE_CODE_USE_VERTEX: "",
  CLAUDE_CODE_USE_FOUNDRY: "",
};

function claudeClient(overrides: Partial<AgentClient> = {}): AgentClient {
  return {
    provider: "claude",
    capabilities: CAPABILITIES,
    getCatalogCacheKey: async () => "host",
    async createSession() {
      throw new Error("not implemented");
    },
    async resumeSession() {
      throw new Error("not implemented");
    },
    async fetchCatalog() {
      return { models: MODELS, modes: [] };
    },
    async isAvailable() {
      return true;
    },
    resolveCreateConfig: () => ({ modeId: "default", featureValues: undefined }),
    ...overrides,
  };
}

async function withManager(
  client: AgentClient,
  run: (manager: ProviderSnapshotManager) => Promise<void>,
): Promise<void> {
  const manager = new ProviderSnapshotManager({
    logger: createTestLogger(),
    extraClients: { claude: client },
  });
  try {
    await run(manager);
  } finally {
    manager.destroy();
  }
}

describe("provider login state in the snapshot", () => {
  test("a ready provider carries the login state its client reports", async () => {
    const client = claudeClient({ getAuthStatus: async () => ({ state: "needs_login" }) });
    await withManager(client, async (manager) => {
      const entry = await manager.getProvider({ provider: "claude", wait: true });
      expect(entry).toMatchObject({
        provider: "claude",
        status: "ready",
        enabled: true,
        models: MODELS,
        auth: { state: "needs_login" },
      });
    });
  });

  test("needing a login does not block creating an agent", async () => {
    const client = claudeClient({ getAuthStatus: async () => ({ state: "needs_login" }) });
    await withManager(client, async (manager) => {
      await expect(
        manager.validateAgentConfiguration({ provider: "claude", model: "claude-sonnet-4-6" }),
      ).resolves.toEqual([]);
      await expect(
        manager.resolveCreateConfig({
          cwd: "/tmp/project",
          provider: "claude",
          requestedMode: undefined,
          featureValues: undefined,
          parent: null,
          unattended: false,
        }),
      ).resolves.toEqual({ modeId: "default", featureValues: undefined });
    });
  });

  test("a login state that cannot be read leaves the provider ready without one", async () => {
    const client = claudeClient({
      getAuthStatus: async () => {
        throw new Error(`auth status failed for ${EMAIL}`);
      },
    });
    await withManager(client, async (manager) => {
      const entry = await manager.getProvider({ provider: "claude", wait: true });
      expect(entry.status).toBe("ready");
      expect(entry.models).toEqual(MODELS);
      expect(Object.keys(entry)).not.toContain("auth");
      expect(JSON.stringify(entry).includes(EMAIL)).toBe(false);
    });
  });

  test("a provider without a login state publishes no field", async () => {
    await withManager(claudeClient(), async (manager) => {
      const entry = await manager.getProvider({ provider: "claude", wait: true });
      expect(entry.status).toBe("ready");
      expect(Object.keys(entry)).not.toContain("auth");
    });
  });

  test("an unavailable provider is not asked for a login state", async () => {
    let asked = 0;
    const client = claudeClient({
      isAvailable: async () => false,
      getAuthStatus: async () => {
        asked++;
        return { state: "needs_login" };
      },
    });
    await withManager(client, async (manager) => {
      const entry = await manager.getProvider({ provider: "claude", wait: true });
      expect(entry.status).toBe("unavailable");
      expect(Object.keys(entry)).not.toContain("auth");
      expect(asked).toBe(0);
    });
  });

  test("logging in shows up on the next refresh", async () => {
    let state = "needs_login";
    const client = claudeClient({ getAuthStatus: async () => ({ state }) });
    await withManager(client, async (manager) => {
      expect((await manager.getProvider({ provider: "claude", wait: true })).auth).toEqual({
        state: "needs_login",
      });
      state = "signed_in";
      await manager.refreshSettingsSnapshot({ providers: ["claude"] });
      expect((await manager.getProvider({ provider: "claude", wait: true })).auth).toEqual({
        state: "signed_in",
      });
    });
  });
});

describe("login state of providers built on Claude", () => {
  test("a custom provider extending Claude reads its own env", async () => {
    const registry = buildProviderRegistry(createTestLogger(), {
      providerOverrides: {
        zai: {
          extends: "claude",
          label: "Z.AI",
          env: { ...NO_CLOUD_PROVIDER, ANTHROPIC_AUTH_TOKEN: TOKEN },
        },
      },
    });
    const client = registry.zai!.createClient(createTestLogger());
    expect(await client.getAuthStatus?.()).toEqual({ state: "configured", method: "auth_token" });
  });

  test("Claude with extra models keeps its login state", async () => {
    const registry = buildProviderRegistry(createTestLogger(), {
      providerOverrides: {
        claude: {
          additionalModels: [{ id: "claude-extra", label: "Extra" }],
          env: { ...NO_CLOUD_PROVIDER, ANTHROPIC_AUTH_TOKEN: "", ANTHROPIC_API_KEY: TOKEN },
        },
      },
    });
    const client = registry.claude!.createClient(createTestLogger());
    expect(await client.getAuthStatus?.()).toEqual({ state: "configured", method: "api_key" });
  });
});
