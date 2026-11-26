import AsyncStorage from "@react-native-async-storage/async-storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createColdStartScenario,
  seedPreviousProcess,
  type ColdStartScenario,
  type DirectoryContent,
  type PersistedWorkspaceLayout,
} from "./woowtech-cold-start-tap.test-support";

// RC-I-21c: a cold-start tap on iOS opened the right workspace but kept its remembered agent.
// Each test is a new app process: the previous one persisted the workspace layouts and the last
// workspace; agent B finished while the app was killed, and its notification launches the app.
// visible() reads what the workspace route shows: "<workspace>/<focused agent>".
const S = "srv_rc21c";
const W = "wks_w";
const W2 = "wks_w2";
const A = "agent-a";
const B = "agent-b";
const C = "agent-c";

interface Fixture {
  layouts: PersistedWorkspaceLayout[];
  remembered: string | null;
  cache: DirectoryContent;
  live: DirectoryContent;
  tap: Record<string, string> | null;
  remembersAgent: string;
  tappedAgent: string;
}

function tapData(workspaceId: string, agentId: string): Record<string, string> {
  return { v: "1", reason: "finished", serverId: S, workspaceId, agentId };
}

// W remembers A; B, in W too, was created after the last cache write.
const SAME_WORKSPACE: Fixture = {
  layouts: [{ workspaceId: W, agentIds: [A], focusedAgentId: A }],
  remembered: W,
  cache: { workspaceIds: [W], agents: [{ id: A, workspaceId: W }] },
  live: {
    workspaceIds: [W],
    agents: [
      { id: A, workspaceId: W },
      { id: B, workspaceId: W },
    ],
  },
  tap: tapData(W, B),
  remembersAgent: `${W}/${A}`,
  tappedAgent: `${W}/${B}`,
};

// W is the last workspace and remembers A; B lives in W2, which remembers C.
const CROSS_WORKSPACE: Fixture = {
  layouts: [
    { workspaceId: W2, agentIds: [C], focusedAgentId: C },
    { workspaceId: W, agentIds: [A], focusedAgentId: A },
  ],
  remembered: W,
  cache: {
    workspaceIds: [W, W2],
    agents: [
      { id: A, workspaceId: W },
      { id: C, workspaceId: W2 },
    ],
  },
  live: {
    workspaceIds: [W, W2],
    agents: [
      { id: A, workspaceId: W },
      { id: C, workspaceId: W2 },
      { id: B, workspaceId: W2 },
    ],
  },
  tap: tapData(W2, B),
  remembersAgent: `${W2}/${C}`,
  tappedAgent: `${W2}/${B}`,
};

const VARIANTS = [
  ["same workspace", SAME_WORKSPACE],
  ["cross workspace", CROSS_WORKSPACE],
] as const;

const scenarios: ColdStartScenario[] = [];

beforeEach(async () => {
  await AsyncStorage.clear();
});
afterEach(() => {
  for (const app of scenarios.splice(0)) app.dispose();
});

async function launchFromTap(fixture: Fixture): Promise<ColdStartScenario> {
  await seedPreviousProcess(S, fixture.layouts);
  const app = createColdStartScenario({ serverId: S, rememberedWorkspaceId: fixture.remembered });
  scenarios.push(app);
  app.native.tap("launch-tap", fixture.tap);
  return app;
}

async function bootUntilCached(app: ColdStartScenario, fixture: Fixture): Promise<void> {
  await app.mountRouter();
  await app.layoutHydrates();
  app.selectionHydrates();
  app.hostRegistryLoads();
  app.cacheRestores(fixture.cache);
  await app.settle();
}

async function bootLive(app: ColdStartScenario, fixture: Fixture): Promise<void> {
  await bootUntilCached(app, fixture);
  app.liveDirectoryArrives(fixture.live);
  await app.settle();
}

describe("cold-start notifications resolve the current host agent (RC-I-21c)", () => {
  for (const [name, fixture] of VARIANTS) {
    it(`${name}: an uncached agent waits for the directory, then replaces the remembered focus`, async () => {
      const app = await launchFromTap(fixture);
      await bootUntilCached(app, fixture);
      expect(app.visible()).toBe(`agent:${B}`);
      expect(app.openTabCalls).toEqual([]);
      expect(app.agentTabs(W)).not.toContain(B);
      expect(app.agentTabs(W2)).not.toContain(B);
      app.liveDirectoryArrives(fixture.live);
      await app.settle();
      expect(app.visible()).toBe(fixture.tappedAgent);
      expect(app.openTabCalls.filter((call) => call.agentId === B)).toEqual([
        {
          workspaceKey: `${S}:${fixture.tap?.workspaceId}`,
          agentId: B,
          pin: true,
          hydrated: true,
        },
      ]);
    });

    it(`${name}: an unknown agent stays on its waiting route while the host is unreachable`, async () => {
      const app = await launchFromTap(fixture);
      await bootUntilCached(app, fixture);
      await app.settle();
      expect(app.visible()).toBe(`agent:${B}`);
      expect(app.native.lastResponse).toBeNull();
      expect(app.openTabCalls).toEqual([]);
    });

    it(`${name}: a cached agent uses its recorded workspace even with a stale payload hint`, async () => {
      const cachedFixture = {
        ...fixture,
        cache: fixture.live,
        tap: { ...fixture.tap, serverId: S, agentId: B, workspaceId: "wks_stale" },
      };
      const app = await launchFromTap(cachedFixture);
      await bootUntilCached(app, cachedFixture);
      expect(app.visible()).toBe(fixture.tappedAgent);
      expect(app.agentTabs("wks_stale")).toEqual([]);
    });
  }

  it("opens an agent with no workspace hint once the live directory arrives", async () => {
    const fixture = {
      ...SAME_WORKSPACE,
      layouts: [],
      remembered: null,
      cache: { workspaceIds: [], agents: [] },
      tap: { serverId: S, agentId: B },
    };
    const app = await launchFromTap(fixture);
    await bootUntilCached(app, fixture);
    expect(app.visible()).toBe(`agent:${B}`);
    expect(app.openTabCalls).toEqual([]);
    app.liveDirectoryArrives(fixture.live);
    await app.settle();
    expect(app.visible()).toBe(`${W}/${B}`);
  });

  it("startup restore cannot replace the tap in any boot order", async () => {
    const orders: Record<string, (app: ColdStartScenario) => Promise<void>> = {
      "tap before boot": async (app) => {
        await app.mountRouter();
        await app.layoutHydrates();
        app.selectionHydrates();
        app.hostRegistryLoads();
      },
      "boot before tap": async (app) => {
        await app.layoutHydrates();
        app.selectionHydrates();
        app.hostRegistryLoads();
        await app.mountRouter();
      },
      "tap between registry and selection": async (app) => {
        await app.layoutHydrates();
        app.hostRegistryLoads();
        await app.mountRouter();
        app.selectionHydrates();
      },
      "layout last": async (app) => {
        app.selectionHydrates();
        app.hostRegistryLoads();
        await app.mountRouter();
        await app.layoutHydrates();
      },
      "host index redirect pending": async (app) => {
        app.setHoldHostIndexRedirect(true);
        await app.layoutHydrates();
        app.selectionHydrates();
        app.hostRegistryLoads();
        await app.mountRouter();
        app.setHoldHostIndexRedirect(false);
      },
    };
    const results: Record<string, string> = {};
    for (const [order, run] of Object.entries(orders)) {
      await AsyncStorage.clear();
      const app = await launchFromTap(SAME_WORKSPACE);
      await run(app);
      app.cacheRestores(SAME_WORKSPACE.cache);
      app.liveDirectoryArrives(SAME_WORKSPACE.live);
      await app.settle();
      results[order] = app.visible();
      app.dispose();
    }
    expect(results).toEqual(
      Object.fromEntries(Object.keys(orders).map((order) => [order, `${W}/${B}`])),
    );
  });

  it("does not acknowledge a launch tap before the startup host index finishes redirecting", async () => {
    const app = await launchFromTap(SAME_WORKSPACE);
    app.setHoldHostIndexRedirect(true);
    await app.mountRouter();
    await app.layoutHydrates();
    app.selectionHydrates();
    app.hostRegistryLoads();
    await app.settle();
    expect(app.visible()).toBe("host:index");
    expect(app.native.clearCalls).toBe(0);
    app.setHoldHostIndexRedirect(false);
    app.liveDirectoryArrives(SAME_WORKSPACE.live);
    await app.settle();
    expect(app.native.clearCalls).toBe(1);
    expect(app.visible()).toBe(`${W}/${B}`);
  });

  it("handles a launch response delivered by the native listener after its initial read was empty", async () => {
    const app = await launchFromTap({ ...SAME_WORKSPACE, tap: null });
    await bootLive(app, SAME_WORKSPACE);
    expect(app.visible()).toBe(`${W}/${A}`);
    await app.tapWhileRunning("late-launch-tap", tapData(W, B));
    expect(app.visible()).toBe(`${W}/${B}`);
  });

  it("acknowledges a notice without IDs without changing startup's remembered workspace", async () => {
    const app = await launchFromTap({ ...CROSS_WORKSPACE, tap: null });
    await bootLive(app, CROSS_WORKSPACE);
    expect(app.visible()).toBe(`${W}/${A}`);
    expect(app.native.lastResponse).toBeNull();
    expect(app.openTabCalls).toEqual([]);
  });

  it("does not consume a deferred tab until both the persisted layout and live workspace are ready", async () => {
    const fixture = { ...SAME_WORKSPACE, cache: SAME_WORKSPACE.live };
    const app = await launchFromTap(fixture);
    app.selectionHydrates();
    app.hostRegistryLoads();
    app.cacheRestores(fixture.cache);
    await app.mountRouter();
    expect(app.openTabCalls).toEqual([]);
    await app.layoutHydrates();
    expect(app.openTabCalls).toEqual([]);
    app.liveDirectoryArrives(fixture.live);
    await app.settle();
    expect(app.visible()).toBe(`${W}/${B}`);
    expect(app.openTabCalls).toEqual([
      { workspaceKey: `${S}:${W}`, agentId: B, pin: true, hydrated: true },
    ]);
  });
});

describe("notification router remount and native delivery identity", () => {
  async function tapLeaveRemount() {
    const app = await launchFromTap(SAME_WORKSPACE);
    app.native.replayPendingOnSubscribe = true;
    await bootLive(app, SAME_WORKSPACE);
    expect(app.visible()).toBe(`${W}/${B}`);
    app.userFocusesAgent(A);
    app.unmountRouter();
    await app.mountRouter();
    return app;
  }

  it("keeps the user's later focus despite Android replaying its pending response list", async () => {
    const app = await tapLeaveRemount();
    expect(app.visible()).toBe(`${W}/${A}`);
    expect(app.native.clearCalls).toBe(1);
    expect(app.native.lastResponse).toBeNull();
    expect(app.openTabCalls.filter((call) => call.agentId === B)).toHaveLength(1);
  });

  it("accepts a later notification even when the relay reuses the same collapse identifier", async () => {
    const app = await tapLeaveRemount();
    await app.tapWhileRunning("launch-tap", tapData(W, B));
    expect(app.visible()).toBe(`${W}/${B}`);
    expect(app.native.clearCalls).toBe(2);
  });

  it("retains the launch tap if the router unmounts while startup is not ready", async () => {
    const app = await launchFromTap(SAME_WORKSPACE);
    await app.mountRouter();
    app.unmountRouter();
    await app.layoutHydrates();
    app.selectionHydrates();
    app.hostRegistryLoads();
    app.liveDirectoryArrives(SAME_WORKSPACE.live);
    await app.settle();
    expect(app.native.clearCalls).toBe(0);
    expect(app.openTabCalls).toEqual([]);
    await app.mountRouter();
    expect(app.visible()).toBe(`${W}/${B}`);
    expect(app.native.clearCalls).toBe(1);
  });
});

describe("authoritative agent lookup and missing-workspace recovery", () => {
  it("uses the current directory after an agent moved while the app was killed", async () => {
    const fixture = { ...CROSS_WORKSPACE, tap: tapData(W, B) };
    const app = await launchFromTap(fixture);
    await bootLive(app, fixture);
    expect(app.visible()).toBe(`${W2}/${B}`);
    expect(app.agentTabs(W)).not.toContain(B);
    expect(app.agentTabs(W2)).toContain(B);
  });

  it("uses a fetched agent record to queue recovery for a workspace missing from the live directory", async () => {
    const app = await launchFromTap(CROSS_WORKSPACE);
    await bootUntilCached(app, CROSS_WORKSPACE);
    app.liveDirectoryArrives(SAME_WORKSPACE.cache);
    app.agentLookupCompletes(B, W2);
    await app.settle();
    expect(app.visible()).toBe(`${W2}/-`);
    expect(app.recovery()).toEqual({ requested: true, inspects: true });
    expect(app.openTabCalls).toEqual([]);

    // A successful restore brings the workspace and agent back through the directory.
    app.liveDirectoryArrives(CROSS_WORKSPACE.live);
    await app.settle();
    expect(app.visible()).toBe(`${W2}/${B}`);
    expect(app.recovery()).toEqual({ requested: false, inspects: false });
    expect(app.openTabCalls.filter((call) => call.agentId === B)).toHaveLength(1);
  });

  it("does not inspect a workspace from a stale hint while the agent is still unresolved", async () => {
    const app = await launchFromTap(CROSS_WORKSPACE);
    await bootUntilCached(app, CROSS_WORKSPACE);
    expect(app.visible()).toBe(`agent:${B}`);
    expect(app.recovery()).toBeNull();
    expect(app.openTabCalls).toEqual([]);
  });

  it("returns to the host when an authoritative lookup says the agent no longer exists", async () => {
    const app = await launchFromTap(CROSS_WORKSPACE);
    await bootUntilCached(app, CROSS_WORKSPACE);
    app.liveDirectoryArrives(SAME_WORKSPACE.cache);
    app.agentLookupCompletes(B, null);
    await app.settle();
    expect(app.visible()).toBe(`${W}/${A}`);
    expect(app.agentTabs(W)).not.toContain(B);
    expect(app.agentTabs(W2)).not.toContain(B);
  });
});
