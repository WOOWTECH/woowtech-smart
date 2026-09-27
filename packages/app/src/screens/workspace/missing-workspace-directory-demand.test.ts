import { afterEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "@/stores/session-store";
import {
  navigateToWorkspace,
  type NavigateToWorkspaceDeps,
} from "@/stores/navigation-active-workspace-store/navigation";
import { resolveWorkspaceRouteState } from "./workspace-route-state";
import { selectVisibleAgentIds } from "./visible-agent-ids";
import {
  createDemandFixture,
  secondWorkspace,
  serverId,
  workspaceId,
  workspace,
} from "./missing-workspace-directory-demand.test-support";

import { parseWorkspaceOpenIntent } from "@/utils/host-routes";
import {
  acquireMissingWorkspaceDirectoryDemand,
  type MissingWorkspaceDirectoryDemandInput,
} from "./missing-workspace-directory-demand";

const fixtures: Awaited<ReturnType<typeof createDemandFixture>>[] = [];
afterEach(async () => {
  for (const current of fixtures.splice(0)) await current.dispose();
});
async function fixture(options?: Parameters<typeof createDemandFixture>[0]) {
  const result = await createDemandFixture(options);
  fixtures.push(result);
  return result;
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

const recovery = {
  kind: "unavailable",
  recovery: {
    kind: "unavailable",
    workspaceId,
    reason: "workspace_not_archived",
    message: "Not available through archive recovery.",
  },
} as const;
function routeState(f: Awaited<ReturnType<typeof fixture>>, id = workspaceId) {
  return resolveWorkspaceRouteState({
    hostName: "Test host",
    connectionStatus: "online",
    lastError: null,
    workspace: f.session()?.workspaces.get(id) ?? null,
    hasHydratedWorkspaces: f.session()?.hasHydratedWorkspaces ?? false,
    recovery,
  });
}

function navigation(f: Awaited<ReturnType<typeof fixture>>) {
  const routes: string[] = [];
  const tabs: Parameters<NavigateToWorkspaceDeps["openTab"]>[0][] = [];
  const deps: NavigateToWorkspaceDeps = {
    getSessionWorkspaces: () => f.session()?.workspaces ?? null,
    getSessionAgents: () => [],
    isWorkspaceLayoutHydrated: () => true,
    openTab: (input) => {
      tabs.push(input);
      return "t1-agent";
    },
    rememberLastWorkspace: () => {},
    navigateToRoute: (route) => {
      routes.push(route);
    },
  };
  const navigate = () =>
    navigateToWorkspace(
      { serverId, workspaceId, target: { kind: "agent", agentId: "t1-agent" } },
      deps,
    );
  return { routes, tabs, navigate };
}

const missingInput = { serverId, workspaceId, isRouteFocused: true, hasWorkspaceDescriptor: false };
const secondInput = { ...missingInput, workspaceId: secondWorkspace.id };

// The hook's effect: when an input changes, React runs the previous cleanup and then the next
// setup. Descriptor arrival, blur and unmount all release through that cleanup.
function missingWorkspaceRoute(f: Fixture, input: MissingWorkspaceDirectoryDemandInput) {
  let current = input;
  let release = acquireMissingWorkspaceDirectoryDemand(f.runtime, current);
  return {
    rerender(patch: Partial<MissingWorkspaceDirectoryDemandInput>) {
      release?.();
      current = { ...current, ...patch };
      release = acquireMissingWorkspaceDirectoryDemand(f.runtime, current);
    },
    holdsDemand: () => release !== undefined,
    unmount() {
      release?.();
      release = undefined;
    },
  };
}

// The fixture replies in microtasks, so one macrotask turn lets any follow-up refresh send
// its request. Used only to prove that no further request goes out.
function settle() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function directory(f: Fixture, id: string) {
  return {
    workspaceRequests: f.transport.count("fetch_workspaces_request"),
    hasWorkspace: f.session()?.workspaces.has(id) ?? false,
  };
}

// Real timeline owner. Its timeline ports throw: only its directory demand is under test.
function directoryOnlyTimeline(f: Fixture) {
  return f.runtime.createViewedTimelineOwner(serverId, {
    observe: () => {
      throw new Error("Timeline is not connected in this directory handoff test");
    },
    readCursor: () => undefined,
    fetchPage: async () => {
      throw new Error("Unexpected timeline page");
    },
    fetchLatestTail: async () => {
      throw new Error("Unexpected timeline tail");
    },
    reportError: (error) => {
      throw error;
    },
    schedule: () => {
      throw new Error("Unexpected timeline retry");
    },
  });
}

describe("missing workspace directory demand", () => {
  it.each([
    { isRouteFocused: false },
    { hasWorkspaceDescriptor: true },
    { serverId: "" },
    { serverId: "   " },
    { workspaceId: "" },
    { workspaceId: "   " },
  ])("does not acquire for inactive, known, or invalid route %j", async (patch) => {
    const f = await fixture();
    const release = acquireMissingWorkspaceDirectoryDemand(f.runtime, {
      ...missingInput,
      ...patch,
    });
    try {
      await f.runtime.refreshDirectories(serverId);
      expect(release).toBeUndefined();
      expect(f.transport.count("fetch_workspaces_request")).toBe(0);
      expect(f.transport.activeSubscriptions.size).toBe(0);
    } finally {
      release?.();
    }
  });

  it.each(["descriptor", "blur", "unmount"] as const)(
    "effect cleanup releases on %s",
    async (transition) => {
      const f = await fixture();
      const release = acquireMissingWorkspaceDirectoryDemand(f.runtime, missingInput);
      await f.runtime.refreshDirectories(serverId);
      expect(f.transport.activeSubscriptions.size).toBe(3);
      if (transition === "descriptor") f.runtime.acceptWorkspaceSnapshots(serverId, [workspace]);
      // Exercise the production cleanup returned to React, then the next effect setup.
      // The source guard separately pins React's dependency list and cleanup return.
      release?.();
      const nextRelease =
        transition === "unmount"
          ? undefined
          : acquireMissingWorkspaceDirectoryDemand(f.runtime, {
              ...missingInput,
              isRouteFocused: transition !== "blur",
              hasWorkspaceDescriptor: f.session()?.workspaces.has(workspaceId) ?? false,
            });
      try {
        await f.runtime.refreshDirectories(serverId);
        expect(nextRelease).toBeUndefined();
        expect(f.transport.activeSubscriptions.size).toBe(0);
        expect(f.transport.count("subscription.release.request")).toBe(3);
        expect(f.transport.count("fetch_workspaces_request")).toBe(1);
      } finally {
        nextRelease?.();
      }
    },
  );

  it("requests the first directory before workspace hydration on a fresh install", async () => {
    const f = await fixture();
    expect(f.session()?.hasHydratedWorkspaces).toBe(false);
    expect(routeState(f)).toEqual({ kind: "loading", hostName: "Test host" });
    f.transport.entries = [workspace];
    const release = acquireMissingWorkspaceDirectoryDemand(f.runtime, missingInput);
    try {
      await f.runtime.refreshDirectories(serverId);
      expect(f.transport.count("fetch_workspaces_request")).toBe(1);
      expect(f.session()?.hasHydratedWorkspaces).toBe(true);
      expect(f.session()?.workspaces.get(workspaceId)?.id).toBe(workspaceId);
      expect(routeState(f)).toEqual({ kind: "ready" });
    } finally {
      release?.();
    }
  });

  it("holds offline demand into a new epoch and preserves the deferred agent target and subscriber handoff", async () => {
    const f = await fixture();
    useSessionStore.getState().setHasHydratedWorkspaces(serverId, true);
    const epoch = f.runtime.getSnapshot(serverId)?.connectionEpoch;
    const nav = navigation(f);
    nav.navigate();
    const intent = parseWorkspaceOpenIntent(
      new URL(nav.routes[0]!, "https://test.invalid").searchParams.get("open"),
    );
    expect(intent).toEqual({ kind: "agent", agentId: "t1-agent" });
    expect(nav.tabs).toEqual([]);
    f.transport.disconnect();
    const release = acquireMissingWorkspaceDirectoryDemand(f.runtime, missingInput);
    await f.runtime.refreshDirectories(serverId);
    expect(f.transport.count("fetch_workspaces_request")).toBe(0);
    f.transport.entries = [workspace];
    f.transport.holdWorkspaces = true;
    await f.connect();
    expect(f.runtime.getSnapshot(serverId)?.connectionEpoch).toBe((epoch ?? 0) + 1);
    // The reconnect itself must send the directory request. A refresh started by the test
    // would hide a missing demand, so assert the request before joining it.
    await expect.poll(() => f.transport.count("fetch_workspaces_request")).toBe(1);
    const refreshed = f.runtime.refreshDirectories(serverId);
    expect(f.transport.count("fetch_workspaces_request")).toBe(1);
    expect(f.session()?.workspaces.has(workspaceId)).toBe(false);
    expect(nav.tabs).toEqual([]);
    f.transport.deliverWorkspaces();
    await refreshed;
    expect(routeState(f)).toEqual({ kind: "ready" });
    nav.navigate();
    expect(nav.tabs).toEqual([
      {
        workspaceKey: "t1-host:t1-workspace",
        target: { kind: "agent", agentId: "t1-agent" },
        pin: false,
        intent: "reveal",
        placement: undefined,
      },
    ]);
    const timeline = directoryOnlyTimeline(f);
    try {
      timeline.replaceVisibleAgentIds("workspace-screen", ["t1-agent"]);
      release?.();
      expect(f.transport.activeSubscriptions.size).toBe(3);
      expect(f.transport.count("fetch_workspaces_request")).toBe(1);
      timeline.dispose();
      await f.runtime.refreshDirectories(serverId);
      expect(f.transport.activeSubscriptions.size).toBe(0);
      expect(f.transport.count("fetch_workspaces_request")).toBe(1);
    } finally {
      timeline.dispose();
      release?.();
    }
  });

  it("focused missing owner requests the directory without a sidebar or agent tab", async () => {
    const f = await fixture();
    useSessionStore.getState().setHasHydratedWorkspaces(serverId, true);
    await f.runtime.prepareWorkspaceRoute(serverId, workspaceId);
    const release = acquireMissingWorkspaceDirectoryDemand(f.runtime, {
      serverId,
      workspaceId,
      isRouteFocused: true,
      hasWorkspaceDescriptor: false,
    });
    try {
      await f.runtime.refreshDirectories(serverId);
      expect(f.transport.count("fetch_workspaces_request")).toBe(1);
      expect(f.transport.count("fetch_agents_request")).toBe(1);
      expect(f.transport.activeSubscriptions.size).toBe(3);
    } finally {
      release?.();
    }
  }, 20000);

  it("witness: cache-only prepare and missing notification tab leave zero directory requests", async () => {
    const f = await fixture();
    useSessionStore.getState().setHasHydratedWorkspaces(serverId, true);
    const nav = navigation(f);
    nav.navigate();
    expect(nav.tabs).toEqual([]);
    expect(nav.routes).toEqual(["/h/t1-host/workspace/t1-workspace?open=agent%3At1-agent"]);
    expect(
      selectVisibleAgentIds({ layout: null, tabs: [], routeFocused: true, focusedPaneOnly: false }),
    ).toEqual([]);
    await f.runtime.prepareWorkspaceRoute(serverId, workspaceId);
    expect(f.rows.reads).toContainEqual({ serverId, kinds: ["workspace"], ids: [workspaceId] });
    await f.runtime.refreshDirectories(serverId);
    expect(f.transport.count("fetch_workspaces_request")).toBe(0);
    expect(f.transport.count("fetch_agents_request")).toBe(0);
    expect(f.session()?.workspaces.has(workspaceId)).toBe(false);
  }, 20000);

  it("witness: an arriving descriptor beats an old unavailable recovery result", async () => {
    const f = await fixture();
    useSessionStore.getState().setHasHydratedWorkspaces(serverId, true);
    expect(routeState(f)).toEqual({
      kind: "recoveryUnavailable",
      hostName: "Test host",
      message: recovery.recovery.message,
    });
    f.runtime.acceptWorkspaceSnapshots(serverId, [workspace]);
    expect(routeState(f)).toEqual({ kind: "ready" });
  });
});

describe("directory demand that leaves while its own refresh is still running", () => {
  async function fixtureWithSlowLabels() {
    const f = await fixture({ workspaceLabels: true });
    useSessionStore.getState().setHasHydratedWorkspaces(serverId, true);
    f.transport.entries = [workspace];
    f.transport.holdLabels = true;
    return f;
  }

  // Both directory lists land, then refreshAll() still waits for the label catalog. The only
  // demand leaves in that window, and the refresh finishes afterwards.
  async function leaveMidRefresh(f: Fixture, leave: () => void) {
    await expect.poll(() => f.transport.heldLabelRequests()).toBe(1);
    expect(f.session()?.workspaces.has(workspaceId)).toBe(true);
    leave();
    await expect.poll(() => f.transport.activeSubscriptions.size).toBe(0);
    f.transport.deliverLabels();
    // Nothing demands the directory now, so this joins the running refresh without starting one.
    await f.runtime.refreshDirectories(serverId);
    expect(directory(f, workspaceId)).toEqual({ workspaceRequests: 1, hasWorkspace: true });
    // Later in the same connection, the computer creates another workspace.
    f.transport.entries = [workspace, secondWorkspace];
  }

  async function expectSecondWorkspaceRefreshed(f: Fixture) {
    await expect
      .poll(() => directory(f, secondWorkspace.id))
      .toEqual({ workspaceRequests: 2, hasWorkspace: true });
  }

  it("the sidebar refreshes a new workspace after the missing-workspace owner left mid-refresh", async () => {
    const f = await fixtureWithSlowLabels();
    const route = missingWorkspaceRoute(f, missingInput);
    await leaveMidRefresh(f, () => route.rerender({ hasWorkspaceDescriptor: true }));
    const closeSidebar = f.runtime.acquireDirectoryDemand(serverId);
    try {
      await expectSecondWorkspaceRefreshed(f);
    } finally {
      closeSidebar();
    }
  });

  it("a second notification route opens its new workspace after the first owner left mid-refresh", async () => {
    const f = await fixtureWithSlowLabels();
    const first = missingWorkspaceRoute(f, missingInput);
    await leaveMidRefresh(f, () => first.rerender({ hasWorkspaceDescriptor: true }));
    const second = missingWorkspaceRoute(f, secondInput);
    try {
      await expectSecondWorkspaceRefreshed(f);
      second.rerender({ hasWorkspaceDescriptor: true });
      expect(second.holdsDemand()).toBe(false);
      expect(routeState(f, secondWorkspace.id)).toEqual({ kind: "ready" });
    } finally {
      second.unmount();
    }
  });

  it("an agent tab that joins the refresh after the owner left still gets live subscriptions", async () => {
    const f = await fixtureWithSlowLabels();
    const route = missingWorkspaceRoute(f, missingInput);
    const timeline = directoryOnlyTimeline(f);
    try {
      await expect.poll(() => f.transport.heldLabelRequests()).toBe(1);
      // One render pass: the descriptor releases the owner and the notification's agent tab
      // opens, so the tab's route demand joins the refresh whose subscriptions were dropped.
      route.rerender({ hasWorkspaceDescriptor: true });
      timeline.replaceVisibleAgentIds("workspace-screen", ["t1-agent"]);
      f.transport.deliverLabels();
      await expect
        .poll(() => ({
          workspaceRequests: f.transport.count("fetch_workspaces_request"),
          subscriptions: f.transport.activeSubscriptions.size,
        }))
        .toEqual({ workspaceRequests: 2, subscriptions: 3 });
    } finally {
      timeline.dispose();
    }
  });

  it("a sidebar opened after the agent tab, the last demand, closed mid-refresh refreshes a new workspace", async () => {
    const f = await fixtureWithSlowLabels();
    const route = missingWorkspaceRoute(f, missingInput);
    const timeline = directoryOnlyTimeline(f);
    try {
      await leaveMidRefresh(f, () => {
        // The agent tab opens before the descriptor releases the owner, so the subscriptions stay.
        timeline.replaceVisibleAgentIds("workspace-screen", ["t1-agent"]);
        route.rerender({ hasWorkspaceDescriptor: true });
        expect(f.transport.activeSubscriptions.size).toBe(3);
        // The user leaves the agent before the label catalog arrives: route demand drops last.
        timeline.replaceVisibleAgentIds("workspace-screen", []);
      });
      const closeSidebar = f.runtime.acquireDirectoryDemand(serverId);
      try {
        await expectSecondWorkspaceRefreshed(f);
      } finally {
        closeSidebar();
      }
    } finally {
      timeline.dispose();
    }
  });

  it("switching from one missing workspace to another while the first refresh is in flight loads the second", async () => {
    const f = await fixture();
    useSessionStore.getState().setHasHydratedWorkspaces(serverId, true);
    f.transport.entries = [workspace, secondWorkspace];
    f.transport.holdWorkspaces = true;
    const first = missingWorkspaceRoute(f, missingInput);
    await expect.poll(() => f.transport.count("fetch_workspaces_request")).toBe(1);
    // One commit: the first route's cleanup releases the pending workspace subscription, which
    // fails its refresh, and the second route's setup joins that failing refresh.
    first.unmount();
    const second = missingWorkspaceRoute(f, secondInput);
    try {
      await expect.poll(() => f.transport.count("fetch_workspaces_request")).toBe(2);
      f.transport.deliverWorkspaces();
      await expect
        .poll(() => ({
          hasSecond: f.session()?.workspaces.has(secondWorkspace.id) ?? false,
          subscriptions: f.transport.activeSubscriptions.size,
        }))
        .toEqual({ hasSecond: true, subscriptions: 3 });
    } finally {
      second.unmount();
    }
  });

  it("upstream: a sidebar reopened after closing mid-refresh refreshes a new workspace", async () => {
    const f = await fixtureWithSlowLabels();
    await leaveMidRefresh(f, f.runtime.acquireDirectoryDemand(serverId));
    const closeSidebar = f.runtime.acquireDirectoryDemand(serverId);
    try {
      await expectSecondWorkspaceRefreshed(f);
    } finally {
      closeSidebar();
    }
  });
});

describe("failed directory refresh", () => {
  // An open sidebar holds the directory demand throughout. Opening an agent adds route demand.
  async function sidebarFixture() {
    const f = await fixture();
    useSessionStore.getState().setHasHydratedWorkspaces(serverId, true);
    f.transport.entries = [workspace];
    return f;
  }

  it("a failed refresh does not satisfy the connection and does not retry by itself", async () => {
    const f = await sidebarFixture();
    f.transport.failWorkspaces = true;
    const closeSidebar = f.runtime.acquireDirectoryDemand(serverId);
    const timeline = directoryOnlyTimeline(f);
    try {
      // Joins the sidebar's refresh, which the host rejects.
      await expect(f.runtime.refreshDirectories(serverId)).rejects.toThrow(
        "Workspace directory unavailable",
      );
      await settle();
      expect(directory(f, workspaceId)).toEqual({ workspaceRequests: 1, hasWorkspace: false });
      f.transport.failWorkspaces = false;
      timeline.replaceVisibleAgentIds("workspace-screen", ["t1-agent"]);
      await expect
        .poll(() => directory(f, workspaceId))
        .toEqual({ workspaceRequests: 2, hasWorkspace: true });
    } finally {
      timeline.dispose();
      closeSidebar();
    }
  });

  it("a failed pull-to-refresh does not leave the connection satisfied", async () => {
    const f = await sidebarFixture();
    const closeSidebar = f.runtime.acquireDirectoryDemand(serverId);
    const timeline = directoryOnlyTimeline(f);
    try {
      await f.runtime.refreshDirectories(serverId);
      f.transport.failWorkspaces = true;
      await expect(f.runtime.refreshDirectories(serverId)).rejects.toThrow(
        "Workspace directory unavailable",
      );
      await settle();
      // The rejected request replaced the live workspace subscription: agents and events remain.
      expect(f.transport.activeSubscriptions.size).toBe(2);
      expect(f.transport.count("fetch_workspaces_request")).toBe(2);
      f.transport.failWorkspaces = false;
      f.transport.entries = [workspace, secondWorkspace];
      timeline.replaceVisibleAgentIds("workspace-screen", ["t1-agent"]);
      await expect
        .poll(() => directory(f, secondWorkspace.id))
        .toEqual({ workspaceRequests: 3, hasWorkspace: true });
    } finally {
      timeline.dispose();
      closeSidebar();
    }
  });
});

describe("missing workspace that never arrives", () => {
  async function reconnect(f: Fixture) {
    f.transport.disconnect();
    await f.connect();
  }

  it("a deleted or archived workspace refreshes once per connection, not in a loop", async () => {
    const f = await fixture();
    useSessionStore.getState().setHasHydratedWorkspaces(serverId, true);
    // Archived or deleted on the computer: no refresh returns it.
    f.transport.entries = [];
    const route = missingWorkspaceRoute(f, missingInput);
    try {
      await f.runtime.refreshDirectories(serverId);
      // The sidebar opens and closes while the owner keeps waiting.
      f.runtime.acquireDirectoryDemand(serverId)();
      await settle();
      expect(directory(f, workspaceId)).toEqual({ workspaceRequests: 1, hasWorkspace: false });
      expect(route.holdsDemand()).toBe(true);
      await reconnect(f);
      await expect.poll(() => f.transport.count("fetch_workspaces_request")).toBe(2);
      await settle();
      await reconnect(f);
      await expect.poll(() => f.transport.count("fetch_workspaces_request")).toBe(3);
      await settle();
      expect(directory(f, workspaceId)).toEqual({ workspaceRequests: 3, hasWorkspace: false });
    } finally {
      route.unmount();
    }
  });

  it("a refresh that times out ends the connection, and the reconnect refreshes once", async () => {
    const f = await fixture();
    useSessionStore.getState().setHasHydratedWorkspaces(serverId, true);
    f.transport.entries = [workspace];
    f.transport.holdWorkspaces = true;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const route = missingWorkspaceRoute(f, missingInput);
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(f.transport.count("fetch_workspaces_request")).toBe(1);
      // The host never answers; the client gives up on the subscription and drops the socket.
      await vi.advanceTimersByTimeAsync(60_000);
      vi.useRealTimers();
      expect(f.runtime.getSnapshot(serverId)).toMatchObject({
        connectionStatus: "error",
        lastError: "Subscription request failed",
      });
      expect(directory(f, workspaceId)).toEqual({ workspaceRequests: 1, hasWorkspace: false });
      f.transport.holdWorkspaces = false;
      await f.connect();
      await expect
        .poll(() => directory(f, workspaceId))
        .toEqual({ workspaceRequests: 2, hasWorkspace: true });
      route.rerender({ hasWorkspaceDescriptor: true });
      await settle();
      expect(directory(f, workspaceId)).toEqual({ workspaceRequests: 2, hasWorkspace: true });
    } finally {
      vi.useRealTimers();
      route.unmount();
    }
  });
});
