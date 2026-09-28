import { afterEach, describe, expect, it } from "vitest";
import { readWorkspaceRouteOpenParam } from "./woowtech-workspace-open-intent";
import {
  createNavigationScenario,
  readMergedOpenParam,
  readOpenParamLikeWorkspaceRoute,
  WORKSPACE_ROUTE_NAME,
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

function tabsOpenedDuring(scenario: NavigationScenario, step: () => void): OpenedTab[] {
  const before = scenario.openedTabs.length;
  step();
  return scenario.openedTabs.slice(before);
}

// S2: the notification names a workspace the app does not know yet, so navigateToWorkspace defers
// the agent as ?open=agent:<id>. The route holds the intent until T1's directory demand brings the
// workspace in, then opens the agent.
function enterS2WorkspaceThroughDelayedOpen(scenario: NavigationScenario): void {
  scenario.tapNotification({
    serverId: SERVER_ID,
    workspaceId: S2_WORKSPACE_ID,
    agentId: S2_AGENT_ID,
    reason: "finished",
  });
  scenario.directoryArrives([S2_WORKSPACE_ID, S3_WORKSPACE_ID, S3B_WORKSPACE_ID]);
}

function tapS3Notification(scenario: NavigationScenario): void {
  scenario.tapNotification({
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
  it("S1: a notification tapped on a workspace screen opens the agent once its workspace arrives", () => {
    const app = openApp(
      `/h/${SERVER_ID}/workspace/${S3_WORKSPACE_ID}`,
      readOpenParamLikeWorkspaceRoute,
    );
    app.directoryArrives([S3_WORKSPACE_ID]);

    app.tapNotification({
      serverId: SERVER_ID,
      workspaceId: S4_WORKSPACE_ID,
      agentId: S4_AGENT_ID,
      reason: "finished",
    });
    expect(focusedWorkspaceId(app)).toBe(S4_WORKSPACE_ID);
    expect(app.hostRouteParams()).toEqual({ serverId: SERVER_ID });
    expect(app.openedTabs).toEqual([]);

    app.directoryArrives([S3_WORKSPACE_ID, S4_WORKSPACE_ID]);
    expect(app.openedTabs).toEqual([agentTab(S4_WORKSPACE_ID, S4_AGENT_ID)]);
  });

  it("S2 opens the notified agent once its workspace arrives", () => {
    const app = openAppOnOpenProject(readOpenParamLikeWorkspaceRoute);

    app.tapNotification({
      serverId: SERVER_ID,
      workspaceId: S2_WORKSPACE_ID,
      agentId: S2_AGENT_ID,
      reason: "finished",
    });
    expect(focusedWorkspaceId(app)).toBe(S2_WORKSPACE_ID);
    expect(app.openedTabs).toEqual([]);

    app.directoryArrives([S2_WORKSPACE_ID, S3_WORKSPACE_ID]);
    expect(app.openedTabs).toEqual([agentTab(S2_WORKSPACE_ID, S2_AGENT_ID)]);
  });

  it("S3: a known workspace's notification opens its own agent, not the one S2 opened", () => {
    const app = openAppOnOpenProject(readOpenParamLikeWorkspaceRoute);
    enterS2WorkspaceThroughDelayedOpen(app);

    const opened = tabsOpenedDuring(app, () => tapS3Notification(app));

    expect(focusedWorkspaceId(app)).toBe(S3_WORKSPACE_ID);
    expect(opened).toEqual([agentTab(S3_WORKSPACE_ID, S3_AGENT_ID)]);
  });

  it("switching to another workspace and back does not reopen the agent S2 opened", () => {
    const app = openAppOnOpenProject(readOpenParamLikeWorkspaceRoute);
    enterS2WorkspaceThroughDelayedOpen(app);

    const opened = tabsOpenedDuring(app, () => {
      app.openWorkspaceFromSidebar(S3B_WORKSPACE_ID);
      expect(focusedWorkspaceId(app)).toBe(S3B_WORKSPACE_ID);
      app.openWorkspaceFromSidebar(S2_WORKSPACE_ID);
      expect(focusedWorkspaceId(app)).toBe(S2_WORKSPACE_ID);
    });

    expect(opened).toEqual([]);
  });

  it("a terminal notification tapped on Open Project does not follow later workspace switches", () => {
    const app = openAppOnOpenProject(readOpenParamLikeWorkspaceRoute);
    app.directoryArrives([S2_WORKSPACE_ID, S3_WORKSPACE_ID]);
    const terminalTab: OpenedTab = {
      workspaceKey: `${SERVER_ID}:${S2_WORKSPACE_ID}`,
      target: { kind: "terminal", terminalId: TERMINAL_ID },
      pin: false,
    };

    app.tapNotification({
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

  // Checks the harness against the Android run: the host route's params match the navigation
  // state logs/ultra-device-s3b.txt recorded, and reading the merged params, as upstream's route
  // does with useGlobalSearchParams, adds S2's agent to S3's workspace after S3's own agent and
  // focuses it, which is what the device showed.
  it("witness: the host route keeps S2's intent, and the merged params reopen it in S3's workspace", () => {
    const app = openAppOnOpenProject(readMergedOpenParam);
    enterS2WorkspaceThroughDelayedOpen(app);

    expect(app.hostRouteParams()).toMatchObject({
      serverId: SERVER_ID,
      workspaceId: S2_WORKSPACE_ID,
      open: `agent:${S2_AGENT_ID}`,
      screen: WORKSPACE_ROUTE_NAME,
    });

    const opened = tabsOpenedDuring(app, () => tapS3Notification(app));

    expect(focusedWorkspaceId(app)).toBe(S3_WORKSPACE_ID);
    expect(opened).toEqual([
      agentTab(S3_WORKSPACE_ID, S3_AGENT_ID),
      agentTab(S3_WORKSPACE_ID, S2_AGENT_ID),
    ]);
  });
});
