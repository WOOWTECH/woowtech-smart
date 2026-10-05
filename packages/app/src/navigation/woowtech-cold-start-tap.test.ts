import AsyncStorage from "@react-native-async-storage/async-storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { forgetHandledNotificationTapsForTest } from "./woowtech-notification-response";
import {
  createColdStartScenario,
  seedPreviousProcess,
  type ColdStartInput,
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
  forgetHandledNotificationTapsForTest();
});

afterEach(() => {
  for (const scenario of scenarios.splice(0)) {
    scenario.dispose();
  }
});

async function launchFromTap(
  fixture: Fixture,
  options: Pick<ColdStartInput, "waitRule" | "router">,
): Promise<ColdStartScenario> {
  await seedPreviousProcess(S, fixture.layouts);
  const app = createColdStartScenario({
    serverId: S,
    persistedLayouts: fixture.layouts,
    rememberedWorkspaceId: fixture.remembered,
    ...options,
  });
  scenarios.push(app);
  // iOS hands the launch tap to the emitter module before JS reads it (EmitterModule.swift:40-46).
  app.native.tap("launch-tap", fixture.tap);
  return app;
}

// The order the code imposes: PushNotificationRouter's effect runs in the root layout's first
// commit, before HostRuntimeBootstrapProvider boots the host registry (_layout.tsx), so the launch
// tap is routed before any session exists. Storage reads land next, then the registry, the cached
// directory (HostRuntimeStore restores it right after the registry), and the live one last.
async function bootUntilCached(app: ColdStartScenario, fixture: Fixture): Promise<void> {
  await app.mountRouter();
  await app.layoutHydrates();
  app.selectionHydrates();
  app.hostRegistryLoads();
  app.cacheRestores(fixture.cache);
}

describe("a cold-start notification tap focuses the tapped agent (RC-I-21c)", () => {
  for (const [name, fixture] of VARIANTS) {
    it(`${name}: as soon as the cached workspace and the layout are in`, async () => {
      const app = await launchFromTap(fixture, { waitRule: "app", router: "app" });

      await bootUntilCached(app, fixture);
      expect(app.visible()).toBe(fixture.tappedAgent);

      app.liveDirectoryArrives(fixture.live);
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

    it(`${name}: while the host cannot be reached`, async () => {
      const app = await launchFromTap(fixture, { waitRule: "app", router: "app" });

      await bootUntilCached(app, fixture);

      expect(app.visible()).toBe(fixture.tappedAgent);
    });

    // Waiting for the live snapshot kept the remembered agent on screen, the device report.
    it(`witness, ${name}: upstream's wait rule shows the remembered agent until the live snapshot`, async () => {
      const app = await launchFromTap(fixture, { waitRule: "upstream", router: "upstream" });

      await bootUntilCached(app, fixture);
      expect(app.visible()).toBe(fixture.remembersAgent);

      app.liveDirectoryArrives(fixture.live);
      expect(app.visible()).toBe(fixture.tappedAgent);
    });
  }

  it("a workspace the store has never seen still waits for the live directory (T1, recovery)", async () => {
    const fixture: Fixture = {
      ...SAME_WORKSPACE,
      layouts: [],
      remembered: null,
      cache: { workspaceIds: [], agents: [] },
    };
    const app = await launchFromTap(fixture, { waitRule: "app", router: "app" });

    await bootUntilCached(app, fixture);
    expect(app.openTabCalls).toEqual([]);

    app.liveDirectoryArrives(fixture.live);
    expect(app.visible()).toBe(`${W}/${B}`);
  });

  it("the startup restore never replaces the tap, in any order the code allows", async () => {
    const orders: Record<string, (app: ColdStartScenario) => Promise<void>> = {
      "tap before boot": async (app) => {
        await app.mountRouter();
        await app.layoutHydrates();
        app.selectionHydrates();
        app.hostRegistryLoads();
      },
      "boot, then tap": async (app) => {
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
      "tap while the host index waits to redirect": async (app) => {
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
      forgetHandledNotificationTapsForTest();
      const app = await launchFromTap(SAME_WORKSPACE, { waitRule: "app", router: "app" });
      await run(app);
      app.cacheRestores(SAME_WORKSPACE.cache);
      results[order] = app.visible();
    }

    expect(results).toEqual(
      Object.fromEntries(Object.keys(orders).map((order) => [order, `${W}/${B}`])),
    );
  });

  it("a launch tap that reaches JS after the cache restore takes the warm path", async () => {
    await seedPreviousProcess(S, SAME_WORKSPACE.layouts);
    const app = createColdStartScenario({
      serverId: S,
      persistedLayouts: SAME_WORKSPACE.layouts,
      rememberedWorkspaceId: W,
      waitRule: "app",
      router: "app",
    });
    scenarios.push(app);
    await bootUntilCached(app, SAME_WORKSPACE);
    expect(app.visible()).toBe(`${W}/${A}`);

    // iOS may call didReceive after JS read an empty getLastNotificationResponse.
    app.tapWhileRunning("late-launch-tap", tapData(W, B));

    expect(app.visible()).toBe(`${W}/${B}`);
  });

  // The relay must put the ids in apns.payload.body: iOS hands JS userInfo["body"] only
  // (EXNotificationSerializer.m:79-83). Without them the tap routes to "/" and the startup
  // restore wins: the cross-workspace tap then shows W, not W2, which tells this apart on a device.
  it("witness: a tap without ids falls back to the remembered workspace", async () => {
    const app = await launchFromTap(
      { ...CROSS_WORKSPACE, tap: null },
      { waitRule: "app", router: "app" },
    );

    await bootUntilCached(app, CROSS_WORKSPACE);
    app.liveDirectoryArrives(CROSS_WORKSPACE.live);

    expect(app.visible()).toBe(`${W}/${A}`);
  });

  it("navigateToWorkspace defers instead of opening the tab before the layout hydrates", async () => {
    const app = await launchFromTap(SAME_WORKSPACE, { waitRule: "app", router: "app" });
    app.selectionHydrates();
    app.hostRegistryLoads();
    app.cacheRestores(SAME_WORKSPACE.cache);
    await app.mountRouter();
    expect(app.openTabCalls).toEqual([]);

    await app.layoutHydrates();

    expect(app.openTabCalls.every((call) => call.hydrated)).toBe(true);
    expect(app.visible()).toBe(`${W}/${B}`);
  });
});

describe("a remounted PushNotificationRouter does not replay the launch tap", () => {
  async function tapLeaveRemount(router: ColdStartInput["router"]): Promise<ColdStartScenario> {
    const app = await launchFromTap(SAME_WORKSPACE, { waitRule: "app", router });
    await bootUntilCached(app, SAME_WORKSPACE);
    expect(app.visible()).toBe(`${W}/${B}`);
    app.userFocusesAgent(A);

    // The root error boundary's Reload, a Fast Refresh of _layout.tsx, or any re-keyed tree.
    app.unmountRouter();
    await app.mountRouter();
    return app;
  }

  it("keeps the agent the user moved to", async () => {
    const app = await tapLeaveRemount("app");

    expect(app.visible()).toBe(`${W}/${A}`);
    expect(app.native.lastResponse).toBeNull();
  });

  it("still routes a later tap", async () => {
    const app = await tapLeaveRemount("app");

    app.tapWhileRunning("second-tap", tapData(W, B));

    expect(app.visible()).toBe(`${W}/${B}`);
  });

  it("witness: upstream's router replays it and pulls the user back to B", async () => {
    const app = await tapLeaveRemount("upstream");

    expect(app.visible()).toBe(`${W}/${B}`);
  });
});

// Upstream #2002: an ?open=agent intent asks the workspace screen to inspect recovery, so a
// workspace archived while the app was killed shows 「Workspace archived」 with Restore. The cached
// directory still lists it until the live snapshot replaces the cache, and the intent is consumed
// against the cache, so the route keeps the request until the live directory decides.
describe("a cold-start tap still requests recovery for a workspace archived meanwhile", () => {
  function withoutWorkspace(content: DirectoryContent, workspaceId: string): DirectoryContent {
    return {
      workspaceIds: content.workspaceIds.filter((id) => id !== workspaceId),
      agents: content.agents.filter((agent) => agent.workspaceId !== workspaceId),
    };
  }

  for (const [name, fixture] of VARIANTS) {
    const tapped = fixture.tap?.workspaceId ?? "";

    it(`${name}: the live directory drops the cached workspace`, async () => {
      const app = await launchFromTap(fixture, { waitRule: "app", router: "app" });

      await bootUntilCached(app, fixture);
      expect(app.visible()).toBe(fixture.tappedAgent);
      expect(app.recovery()).toEqual({ requested: true, inspects: false });

      app.liveDirectoryArrives(withoutWorkspace(fixture.live, tapped));
      expect(app.recovery()).toEqual({ requested: true, inspects: true });
    });

    it(`witness, ${name}: upstream's wait rule requests it the same way`, async () => {
      const app = await launchFromTap(fixture, { waitRule: "upstream", router: "upstream" });

      await bootUntilCached(app, fixture);
      app.liveDirectoryArrives(withoutWorkspace(fixture.live, tapped));

      expect(app.recovery()).toEqual({ requested: true, inspects: true });
    });
  }

  it("ends once the live directory has the workspace, as upstream's consumption did", async () => {
    const app = await launchFromTap(SAME_WORKSPACE, { waitRule: "app", router: "app" });
    await bootUntilCached(app, SAME_WORKSPACE);

    app.liveDirectoryArrives(SAME_WORKSPACE.live);
    expect(app.recovery()).toEqual({ requested: false, inspects: false });

    // Archived later, while the user is on it: not this route's intent any more.
    app.liveDirectoryArrives(withoutWorkspace(SAME_WORKSPACE.live, W));
    expect(app.recovery()).toEqual({ requested: false, inspects: false });
  });

  it("stays requested without inspecting while the host cannot be reached", async () => {
    const app = await launchFromTap(SAME_WORKSPACE, { waitRule: "app", router: "app" });

    await bootUntilCached(app, SAME_WORKSPACE);

    expect(app.visible()).toBe(`${W}/${B}`);
    expect(app.recovery()).toEqual({ requested: true, inspects: false });
  });

  it("a tap after the live directory does not latch it", async () => {
    await seedPreviousProcess(S, SAME_WORKSPACE.layouts);
    const app = createColdStartScenario({
      serverId: S,
      persistedLayouts: SAME_WORKSPACE.layouts,
      rememberedWorkspaceId: W,
      waitRule: "app",
      router: "app",
    });
    scenarios.push(app);
    await bootUntilCached(app, SAME_WORKSPACE);
    app.liveDirectoryArrives(SAME_WORKSPACE.live);

    app.tapWhileRunning("warm-tap", tapData(W, B));

    expect(app.visible()).toBe(`${W}/${B}`);
    expect(app.recovery()).toEqual({ requested: false, inspects: false });
  });
});
