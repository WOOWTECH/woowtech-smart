import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceRecoveryModel } from "@/workspace-recovery/model";
import { useSessionStore } from "@/stores/session-store";
import { acquireMissingWorkspaceDirectoryDemand } from "./missing-workspace-directory-demand";
import {
  createDemandFixture,
  serverId,
  workspace,
  workspaceId,
} from "./missing-workspace-directory-demand.test-support";
import { resolveWorkspaceRouteState } from "./workspace-route-state";
import {
  hasSettledWorkspaceDirectory,
  isDirectoryRefreshSettled,
} from "./woowtech-workspace-directory-settled";

// S1 (woowtech/README.md, 16 T1): a notification opens a workspace created while the app was in
// the background. The reconnect's directory refresh brings its descriptor. Real HostRuntimeStore,
// DirectorySync and DaemonClient over the T1 memory host; no React tree.

const fixtures: Awaited<ReturnType<typeof createDemandFixture>>[] = [];
afterEach(async () => {
  for (const current of fixtures.splice(0)) await current.dispose();
});
async function fixture() {
  const result = await createDemandFixture();
  fixtures.push(result);
  return result;
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

const missingRoute = {
  serverId,
  workspaceId,
  isRouteFocused: true,
  hasWorkspaceDescriptor: false,
};

// What the daemon's recovery inspection answers for a workspace it has but the app has not
// loaded yet: it is not archived, so it reads as unavailable.
const notArchived: WorkspaceRecoveryModel = {
  kind: "unavailable",
  recovery: {
    kind: "unavailable",
    workspaceId,
    reason: "workspace_not_archived",
    message: "This workspace is not archived, but it is unavailable from the host.",
  },
};

function directorySettled(f: Fixture): boolean {
  return isDirectoryRefreshSettled(f.runtime.getSnapshot(serverId));
}

/** The route state the workspace screen resolves, given what recovery inspection returned. */
function screen(f: Fixture, recovery: WorkspaceRecoveryModel = { kind: "idle" }) {
  const snapshot = f.runtime.getSnapshot(serverId);
  return resolveWorkspaceRouteState({
    hostName: "Test host",
    connectionStatus: snapshot?.connectionStatus ?? "connecting",
    lastError: null,
    workspace: f.session()?.workspaces.get(workspaceId) ?? null,
    hasHydratedWorkspaces: hasSettledWorkspaceDirectory({
      hasHydratedWorkspaces: f.session()?.hasHydratedWorkspaces ?? false,
      directoryRefreshSettled: directorySettled(f),
    }),
    recovery,
  }).kind;
}

async function reconnect(f: Fixture) {
  f.transport.disconnect();
  await f.connect();
}

describe("a workspace missing from the directory waits for this connection's refresh", () => {
  it("shows loading, not unavailable, until the reconnect's refresh brings it (S1)", async () => {
    const f = await fixture();
    // The app loaded the directory before it went to the background.
    useSessionStore.getState().setHasHydratedWorkspaces(serverId, true);
    f.transport.entries = [workspace];
    f.transport.holdWorkspaces = true;
    await reconnect(f);
    const release = acquireMissingWorkspaceDirectoryDemand(f.runtime, missingRoute);
    try {
      await expect.poll(() => f.transport.count("fetch_workspaces_request")).toBe(1);

      expect(directorySettled(f)).toBe(false);
      expect(screen(f)).toBe("loading");
      // Hydration alone judged the workspace missing, and a recovery inspection sent now
      // answered "unavailable": the 0.6-0.9 s flash on Android.
      expect(
        resolveWorkspaceRouteState({
          hostName: "Test host",
          connectionStatus: "online",
          lastError: null,
          workspace: null,
          hasHydratedWorkspaces: true,
          recovery: notArchived,
        }).kind,
      ).toBe("recoveryUnavailable");

      f.transport.deliverWorkspaces();
      await expect.poll(() => screen(f)).toBe("ready");
      await expect.poll(() => directorySettled(f)).toBe(true);
    } finally {
      release?.();
    }
  });

  it("still ends in 工作區不可用 for a workspace the host no longer has", async () => {
    const f = await fixture();
    useSessionStore.getState().setHasHydratedWorkspaces(serverId, true);
    f.transport.entries = [];
    const release = acquireMissingWorkspaceDirectoryDemand(f.runtime, missingRoute);
    try {
      await expect.poll(() => directorySettled(f)).toBe(true);
      expect(screen(f)).toBe("missing");
      expect(
        screen(f, {
          kind: "unavailable",
          recovery: { ...notArchived.recovery, reason: "workspace_not_found" },
        }),
      ).toBe("recoveryUnavailable");
    } finally {
      release?.();
    }
  });

  it("judges the workspace after a failed refresh instead of loading forever", async () => {
    const f = await fixture();
    useSessionStore.getState().setHasHydratedWorkspaces(serverId, true);
    f.transport.failWorkspaces = true;
    const release = acquireMissingWorkspaceDirectoryDemand(f.runtime, missingRoute);
    try {
      await expect.poll(() => f.transport.count("fetch_workspaces_request")).toBe(1);
      await expect.poll(() => directorySettled(f)).toBe(true);
      expect(screen(f)).toBe("missing");
    } finally {
      release?.();
    }
  });

  it("waits again for the refresh of a new connection, and is unreachable while offline", async () => {
    const f = await fixture();
    useSessionStore.getState().setHasHydratedWorkspaces(serverId, true);
    f.transport.entries = [];
    const release = acquireMissingWorkspaceDirectoryDemand(f.runtime, missingRoute);
    try {
      await expect.poll(() => directorySettled(f)).toBe(true);
      const epoch = f.runtime.getSnapshot(serverId)?.connectionEpoch ?? 0;

      f.transport.disconnect();
      await expect.poll(() => screen(f)).toBe("unreachable");

      f.transport.entries = [workspace];
      f.transport.holdWorkspaces = true;
      await f.connect();
      expect(f.runtime.getSnapshot(serverId)?.connectionEpoch).toBe(epoch + 1);
      await expect.poll(() => f.transport.count("fetch_workspaces_request")).toBe(2);
      expect(directorySettled(f)).toBe(false);
      expect(screen(f)).toBe("loading");

      f.transport.deliverWorkspaces();
      await expect.poll(() => screen(f)).toBe("ready");
      await expect.poll(() => directorySettled(f)).toBe(true);
    } finally {
      release?.();
    }
  });
});
