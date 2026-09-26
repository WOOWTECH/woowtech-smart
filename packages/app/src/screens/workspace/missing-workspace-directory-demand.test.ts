import { afterEach, describe, expect, it } from "vitest";
import { useSessionStore } from "@/stores/session-store";
import {
  navigateToWorkspace,
  type NavigateToWorkspaceDeps,
} from "@/stores/navigation-active-workspace-store/navigation";
import { resolveWorkspaceRouteState } from "./workspace-route-state";
import { selectVisibleAgentIds } from "./visible-agent-ids";
import {
  createDemandFixture,
  serverId,
  workspaceId,
  workspace,
} from "./missing-workspace-directory-demand.test-support";

import { parseWorkspaceOpenIntent } from "@/utils/host-routes";
import { acquireMissingWorkspaceDirectoryDemand } from "./missing-workspace-directory-demand";

const fixtures: Awaited<ReturnType<typeof createDemandFixture>>[] = [];
afterEach(async () => {
  for (const current of fixtures.splice(0)) await current.dispose();
});
async function fixture() {
  const result = await createDemandFixture();
  fixtures.push(result);
  return result;
}

const recovery = {
  kind: "unavailable",
  recovery: {
    kind: "unavailable",
    workspaceId,
    reason: "workspace_not_archived",
    message: "Not available through archive recovery.",
  },
} as const;
function routeState(f: Awaited<ReturnType<typeof fixture>>) {
  return resolveWorkspaceRouteState({
    hostName: "Test host",
    connectionStatus: "online",
    lastError: null,
    workspace: f.session()?.workspaces.get(workspaceId) ?? null,
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
    // Wait for the epoch-triggered request BEFORE joining the refresh: the test
    // must not be the owner that starts network work.
    await f.transport.waitForWorkspaceRequest();
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
    const timeline = f.runtime.createViewedTimelineOwner(serverId, {
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
