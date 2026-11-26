import { afterEach, describe, expect, it } from "vitest";
import { readWorkspaceRouteOpenParam } from "./woowtech-workspace-open-intent";
import {
  createNavigationScenario,
  readOpenParamLikeWorkspaceRoute,
  WORKSPACE_ROUTE_NAME,
  AGENT_ROUTE_NAME,
  type NavigationScenario,
  type OpenedTab,
  type OpenParamReader,
} from "./woowtech-workspace-open-intent.test-support";

// Workspace and agent IDs of the Android run (woowtech-smart logs/ultra-device.md): S2 entered a new
// workspace from the host home through the delayed open, then S3 and S3b notified known workspaces.
// The log shortens the server ID, and the run had no terminal notification.
const SERVER_ID = "srv_cXBAq2w9LmZt";
const S2_WORKSPACE_ID = "wks_ec301f0d67269335";
const S2_AGENT_ID = "05caa698-07f5-4f4e-a77f-54b9edb1b5f0";
const S3_WORKSPACE_ID = "wks_d60e809fc2eec985";
const S3_AGENT_ID = "4596ffa3-37c2-45c5-9039-fd78f5cea541";
const S3B_WORKSPACE_ID = "wks_9c636c51c5c90f2f";
const S4_WORKSPACE_ID = "wks_74c7e01016c2c8b6";
const S4_AGENT_ID = "306a9fd2-8769-4122-b55b-ab04d8a5ed93";
const TERMINAL_ID = "7a4c1f0e-2b8d-4e61-9c35-0d2f6a8b1e47";

const scenarios: NavigationScenario[] = [];

afterEach(() => {
  for (const scenario of scenarios.splice(0)) {
    scenario.dispose();
  }
});

function openApp(startAt: string, readOpenParam: OpenParamReader): NavigationScenario {
  const scenario = createNavigationScenario({ serverId: SERVER_ID, startAt, readOpenParam });
  scenarios.push(scenario);
  return scenario;
}

// The host home right after connecting is the root-level Open Project screen: the host has no
// remembered workspace yet, and the welcome screen replaces itself with /open-project.
function openAppOnOpenProject(readOpenParam: OpenParamReader): NavigationScenario {
  return openApp("/open-project", readOpenParam);
}

function focusedWorkspaceId(scenario: NavigationScenario): unknown {
  const { route } = scenario.focusedRoute();
  if (route.name !== WORKSPACE_ROUTE_NAME) {
    return route.name;
  }
  return (route.params as { workspaceId?: unknown } | undefined)?.workspaceId;
}

function agentTab(workspaceId: string, agentId: string): OpenedTab {
  return {
    workspaceKey: `${SERVER_ID}:${workspaceId}`,
    target: { kind: "agent", agentId },
    pin: true,
  };
}

async function tabsOpenedDuring(
  scenario: NavigationScenario,
  step: () => void | Promise<void>,
): Promise<OpenedTab[]> {
  const before = scenario.openedTabs.length;
  await step();
  return scenario.openedTabs.slice(before);
}

const AGENTS = [
  { id: S2_AGENT_ID, workspaceId: S2_WORKSPACE_ID },
  { id: S3_AGENT_ID, workspaceId: S3_WORKSPACE_ID },
  { id: S4_AGENT_ID, workspaceId: S4_WORKSPACE_ID },
];

// An unknown agent opens the host agent route. Only the host directory resolves its workspace.
async function enterS2WorkspaceThroughDelayedOpen(scenario: NavigationScenario): Promise<void> {
  await scenario.tapNotification({
    serverId: SERVER_ID,
    workspaceId: S2_WORKSPACE_ID,
    agentId: S2_AGENT_ID,
    reason: "finished",
  });
  scenario.directoryArrives([S2_WORKSPACE_ID, S3_WORKSPACE_ID, S3B_WORKSPACE_ID], AGENTS);
}

function tapS3Notification(scenario: NavigationScenario): Promise<void> {
  return scenario.tapNotification({
    serverId: SERVER_ID,
    workspaceId: S3_WORKSPACE_ID,
    agentId: S3_AGENT_ID,
    reason: "finished",
  });
}

describe("workspace open intent entered from outside the host stack (T1 S3)", () => {
  it("reads the route's own open param, the first of several, trimmed", () => {
    expect(readWorkspaceRouteOpenParam({ open: ` agent:${S2_AGENT_ID} ` })).toBe(
      `agent:${S2_AGENT_ID}`,
    );
    expect(readWorkspaceRouteOpenParam({ open: [`terminal:${TERMINAL_ID}`, "agent:x"] })).toBe(
      `terminal:${TERMINAL_ID}`,
    );
    expect(readWorkspaceRouteOpenParam({})).toBe("");
  });

  // S1 and S4 on the device: from a workspace screen the host route is already mounted, the
  // dismissTo lands on the host stack, and only the workspace route gets ?open.
  it("S1: an unknown agent waits on its host route until the directory arrives", async () => {
    const app = openApp(
      `/h/${SERVER_ID}/workspace/${S3_WORKSPACE_ID}`,
      readOpenParamLikeWorkspaceRoute,
    );
    app.directoryArrives([S3_WORKSPACE_ID]);

    await app.tapNotification({
      serverId: SERVER_ID,
      workspaceId: S4_WORKSPACE_ID,
      agentId: S4_AGENT_ID,
      reason: "finished",
    });
    expect(focusedWorkspaceId(app)).toBe(AGENT_ROUTE_NAME);
    expect(app.hostRouteParams()).toEqual({ serverId: SERVER_ID });
    expect(app.openedTabs).toEqual([]);

    app.directoryArrives([S3_WORKSPACE_ID, S4_WORKSPACE_ID], AGENTS);
    expect(app.openedTabs).toEqual([agentTab(S4_WORKSPACE_ID, S4_AGENT_ID)]);
  });

  it("S2 opens the notified agent once its directory record arrives", async () => {
    const app = openAppOnOpenProject(readOpenParamLikeWorkspaceRoute);

    await app.tapNotification({
      serverId: SERVER_ID,
      workspaceId: S2_WORKSPACE_ID,
      agentId: S2_AGENT_ID,
      reason: "finished",
    });
    expect(focusedWorkspaceId(app)).toBe(AGENT_ROUTE_NAME);
    expect(app.openedTabs).toEqual([]);

    app.directoryArrives([S2_WORKSPACE_ID, S3_WORKSPACE_ID], AGENTS);
    expect(app.openedTabs).toEqual([agentTab(S2_WORKSPACE_ID, S2_AGENT_ID)]);
  });

  it("S3: a known workspace's notification opens its own agent, not the one S2 opened", async () => {
    const app = openAppOnOpenProject(readOpenParamLikeWorkspaceRoute);
    await enterS2WorkspaceThroughDelayedOpen(app);

    const opened = await tabsOpenedDuring(app, () => tapS3Notification(app));

    expect(focusedWorkspaceId(app)).toBe(S3_WORKSPACE_ID);
    expect(opened).toEqual([agentTab(S3_WORKSPACE_ID, S3_AGENT_ID)]);
  });

  it("switching to another workspace and back does not reopen the agent S2 opened", async () => {
    const app = openAppOnOpenProject(readOpenParamLikeWorkspaceRoute);
    await enterS2WorkspaceThroughDelayedOpen(app);

    const opened = await tabsOpenedDuring(app, () => {
      app.openWorkspaceFromSidebar(S3B_WORKSPACE_ID);
      expect(focusedWorkspaceId(app)).toBe(S3B_WORKSPACE_ID);
      app.openWorkspaceFromSidebar(S2_WORKSPACE_ID);
      expect(focusedWorkspaceId(app)).toBe(S2_WORKSPACE_ID);
    });

    expect(opened).toEqual([]);
  });

  it("a terminal notification tapped on Open Project does not follow later workspace switches", async () => {
    const app = openAppOnOpenProject(readOpenParamLikeWorkspaceRoute);
    app.directoryArrives([S2_WORKSPACE_ID, S3_WORKSPACE_ID], AGENTS);
    const terminalTab: OpenedTab = {
      workspaceKey: `${SERVER_ID}:${S2_WORKSPACE_ID}`,
      target: { kind: "terminal", terminalId: TERMINAL_ID },
      pin: false,
    };

    await app.tapNotification({
      serverId: SERVER_ID,
      workspaceId: S2_WORKSPACE_ID,
      terminalId: TERMINAL_ID,
      reason: "finished",
    });
    expect(app.openedTabs).toEqual([terminalTab]);

    app.openWorkspaceFromSidebar(S3_WORKSPACE_ID);
    expect(focusedWorkspaceId(app)).toBe(S3_WORKSPACE_ID);
    expect(app.openedTabs).toEqual([terminalTab]);
  });

  it("a legacy bookmark consumes its own open intent without leaking it into a later notification", async () => {
    const app = openAppOnOpenProject(readOpenParamLikeWorkspaceRoute);
    app.openLink(`/h/${SERVER_ID}/workspace/${S2_WORKSPACE_ID}?open=agent:${S2_AGENT_ID}`);
    expect(app.openedTabs).toEqual([]);
    app.directoryArrives([S2_WORKSPACE_ID, S3_WORKSPACE_ID], AGENTS);
    expect(app.openedTabs).toEqual([agentTab(S2_WORKSPACE_ID, S2_AGENT_ID)]);
    const opened = await tabsOpenedDuring(app, () => tapS3Notification(app));
    expect(focusedWorkspaceId(app)).toBe(S3_WORKSPACE_ID);
    expect(opened).toEqual([agentTab(S3_WORKSPACE_ID, S3_AGENT_ID)]);
  });

  it("ignores a stale notification workspace when the host has moved the agent", async () => {
    const app = openAppOnOpenProject(readOpenParamLikeWorkspaceRoute);
    app.directoryArrives([S2_WORKSPACE_ID, S3_WORKSPACE_ID], AGENTS);
    await app.tapNotification({
      serverId: SERVER_ID,
      workspaceId: S2_WORKSPACE_ID,
      agentId: S3_AGENT_ID,
    });
    expect(focusedWorkspaceId(app)).toBe(S3_WORKSPACE_ID);
    expect(app.openedTabs).toEqual([agentTab(S3_WORKSPACE_ID, S3_AGENT_ID)]);
  });

  it("does not need a workspace hint to resolve an agent from the live directory", async () => {
    const app = openAppOnOpenProject(readOpenParamLikeWorkspaceRoute);
    await app.tapNotification({ serverId: SERVER_ID, agentId: S2_AGENT_ID });
    expect(focusedWorkspaceId(app)).toBe(AGENT_ROUTE_NAME);
    app.directoryArrives([S2_WORKSPACE_ID], AGENTS);
    expect(app.openedTabs).toEqual([agentTab(S2_WORKSPACE_ID, S2_AGENT_ID)]);
  });
});
