import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { AgentUsage } from "../../server/agent/agent-sdk-types.js";
import type { ProviderSnapshotManager } from "../../server/agent/provider-snapshot-manager.js";
import { OmpUsagePoller } from "../../server/agent/providers/omp/usage-poller.js";
import { PiUsagePoller } from "../../server/agent/providers/pi/usage-poller.js";
import type { SessionOutboundMessage } from "../../server/messages.js";
import {
  ProviderCatalogSession,
  type ProviderCatalogSessionHost,
} from "../../server/session/provider/provider-catalog-session.js";
import { createStub } from "../../server/test-utils/class-mocks.js";
import { findByType } from "../../server/test-utils/session-stubs.js";
import { isProviderUsageFetchingEnabled } from "../../server/woowtech-provider-usage-policy.js";
import type { ProviderUsageFetcher } from "./provider.js";
import { ClaudeQuotaProvider } from "./providers/claude.js";
import { ProviderUsageService } from "./service.js";

const NOW = Date.parse("2026-09-29T00:00:00.000Z");
const EMPTY_USAGE = { fetchedAt: "2026-09-29T00:00:00.000Z", providers: [] };
const logger = pino({ level: "silent" });

interface UsageProbe {
  calls: { fetcher: number; keychain: number; network: string[] };
  fetchers: ProviderUsageFetcher[];
}

// Counts every way the usage path can reach an account: a fetcher call, a keychain read
// and an HTTP request. Claude's real fetcher gets a temporary home, a keychain stub and a
// fetch stub, so it never touches the real ~/.claude, keychain or network, even when a
// test turns the policy on.
function createUsageProbe(claudeHome: string): UsageProbe {
  const calls: UsageProbe["calls"] = { fetcher: 0, keychain: 0, network: [] };
  const stubFetcher: ProviderUsageFetcher = {
    providerId: "stub",
    displayName: "Stub",
    fetchUsage: async () => {
      calls.fetcher += 1;
      return {
        providerId: "stub",
        displayName: "Stub",
        status: "available",
        planLabel: null,
        windows: [],
      };
    },
  };
  const claude = new ClaudeQuotaProvider({
    logger,
    claudeHome,
    platform: "darwin",
    claudeKeychainReader: async () => {
      calls.keychain += 1;
      return { claudeAiOauth: { accessToken: "at_stub", subscriptionType: "pro" } };
    },
    fetch: (async (url: RequestInfo | URL) => {
      calls.network.push(url.toString());
      return new Response(
        JSON.stringify({ five_hour: { utilization: 10, resets_at: "2026-09-29T05:00:00Z" } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch,
  });
  return { calls, fetchers: [stubFetcher, claude] };
}

function createUsageRpc(providerUsageService: ProviderUsageService) {
  const emitted: SessionOutboundMessage[] = [];
  const session = new ProviderCatalogSession({
    host: createStub<ProviderCatalogSessionHost>({
      emit: (message: SessionOutboundMessage) => emitted.push(message),
    }),
    providerSnapshotManager: createStub<ProviderSnapshotManager>({}),
    providerUsageService,
    logger,
  });
  return { session, emitted };
}

let claudeHome: string;

beforeEach(() => {
  claudeHome = mkdtempSync(join(tmpdir(), "woowtech-usage-off-claude-"));
});

afterEach(() => {
  rmSync(claudeHome, { recursive: true, force: true });
});

describe("woowtech OFF baseline: account usage", () => {
  test("the fork policy keeps account usage off", () => {
    expect(isProviderUsageFetchingEnabled()).toBe(false);
  });

  test("the usage service answers an empty list without a fetcher, keychain or network call", async () => {
    const probe = createUsageProbe(claudeHome);
    const service = new ProviderUsageService({
      logger,
      now: () => NOW,
      fetchers: probe.fetchers,
    });

    await expect(service.listUsage()).resolves.toEqual(EMPTY_USAGE);
    await expect(service.listUsage({ forceRefresh: true })).resolves.toEqual(EMPTY_USAGE);

    expect(probe.calls).toEqual({ fetcher: 0, keychain: 0, network: [] });
  });

  test("the usage RPC answers an empty list, not an error, and reads no account", async () => {
    const probe = createUsageProbe(claudeHome);
    const { session, emitted } = createUsageRpc(
      new ProviderUsageService({ logger, now: () => NOW, fetchers: probe.fetchers }),
    );

    await session.handleProviderUsageListRequest({
      type: "provider.usage.list.request",
      requestId: "usage-1",
    });

    expect(emitted).toEqual([
      {
        type: "provider.usage.list.response",
        payload: { requestId: "usage-1", ...EMPTY_USAGE },
      },
    ]);
    expect(probe.calls).toEqual({ fetcher: 0, keychain: 0, network: [] });
  });
});

describe("explicit upstream test policy", () => {
  test("with usage on, the same probe sees the fetcher, the keychain and the network", async () => {
    const probe = createUsageProbe(claudeHome);
    const { session, emitted } = createUsageRpc(
      new ProviderUsageService({
        logger,
        now: () => NOW,
        fetchers: probe.fetchers,
        isUsageFetchingEnabled: () => true,
      }),
    );

    await session.handleProviderUsageListRequest({
      type: "provider.usage.list.request",
      requestId: "usage-2",
    });

    const response = findByType(emitted, "provider.usage.list.response");
    expect(response?.payload.providers.map((usage) => usage.providerId)).toEqual([
      "stub",
      "claude",
    ]);
    expect(probe.calls).toEqual({
      fetcher: 1,
      keychain: 1,
      network: ["https://api.anthropic.com/api/oauth/usage"],
    });
  });
});

describe("per-session token and context counts stay on", () => {
  const sessionStats = {
    tokens: { input: 1200, cacheRead: 300, output: 450 },
    cost: 0.02,
    contextUsage: { contextWindow: 200_000, tokens: 1950 },
  };
  const expectedUsage: AgentUsage = {
    inputTokens: 1200,
    cachedInputTokens: 300,
    outputTokens: 450,
    totalCostUsd: 0.02,
    contextWindowMaxTokens: 200_000,
    contextWindowUsedTokens: 1950,
  };

  test("Pi reports the session's own counts while account usage is off", async () => {
    const updates: Array<{ usage: AgentUsage; turnId?: string }> = [];
    const poller = new PiUsagePoller({
      readStats: async () => sessionStats,
      onUsage: (usage, turnId) => updates.push({ usage, turnId }),
      onPollError: (error) => {
        throw error;
      },
    });

    await poller.completeTurn("turn-pi");

    expect(isProviderUsageFetchingEnabled()).toBe(false);
    expect(updates).toEqual([{ usage: expectedUsage, turnId: "turn-pi" }]);
  });

  test("OMP reports the session's own counts while account usage is off", async () => {
    const updates: Array<{ usage: AgentUsage; turnId?: string }> = [];
    const poller = new OmpUsagePoller({
      readStats: async () => sessionStats,
      onUsage: (usage, turnId) => updates.push({ usage, turnId }),
      onPollError: (error) => {
        throw error;
      },
    });

    await poller.completeTurn("turn-omp");

    expect(isProviderUsageFetchingEnabled()).toBe(false);
    expect(updates).toEqual([{ usage: expectedUsage, turnId: "turn-omp" }]);
  });
});
