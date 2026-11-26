import { afterEach, describe, expect, it } from "vitest";
import {
  createNavigationScenario,
  readOpenParamLikeWorkspaceRoute,
  welcomeEffectLikeUpstream,
  WORKSPACE_ROUTE_NAME,
  AGENT_ROUTE_NAME,
  type NavigationScenario,
  type OpenedTab,
  type WelcomeEffectModel,
} from "./woowtech-workspace-open-intent.test-support";

// IDs of the Android run (woowtech-smart logs/integ0929-real-android.md, run 1): a fresh app paired
// its first host through a relay pairing link, went to the background, and the agent asked for a
// permission in a workspace the app had not seen. The log masks the server ID.
const SERVER_ID = "srv_welcomeTap01";
const WORKSPACE_ID = "wks_7ed7e0067ba69a21";
const AGENT_ID = "9651618c-f095-42c4-a84c-349879dc6517";

const scenarios: NavigationScenario[] = [];

afterEach(() => {
  for (const scenario of scenarios.splice(0)) {
    scenario.dispose();
  }
});

// No saved host: the root stack starts on the welcome screen.
function openFreshApp(welcomeEffect?: WelcomeEffectModel): NavigationScenario {
  const scenario = createNavigationScenario({
    serverId: SERVER_ID,
    startAt: "/welcome",
    readOpenParam: readOpenParamLikeWorkspaceRoute,
    welcomeEffect,
  });
  scenarios.push(scenario);
  return scenario;
}

// The pairing link reaches the running app (am start, or a camera app). expo-router's linking
// navigates to the link's path, /, and the root stack pushes the index route over the welcome
// screen. OfferLinkListener saves the host and replaces the screen on top with /open-project
// (runtime/woowtech-pairing-link.ts), then the host connects.
function pairFirstHostThroughLink(app: NavigationScenario): void {
  app.openLink("/");
  app.replace("/open-project");
  app.setAnyOnlineHost(SERVER_ID);
}

// In the background the daemon drops the app's connection; the agent then asks for a permission
// in a new workspace, and the notification is tapped while the host is still offline.
async function tapPermissionNotificationAfterBackground(app: NavigationScenario): Promise<void> {
  app.setAnyOnlineHost(null);
  await app.tapNotification({
    serverId: SERVER_ID,
    workspaceId: WORKSPACE_ID,
    agentId: AGENT_ID,
    reason: "permission",
  });
}

function focusedWorkspaceId(scenario: NavigationScenario): unknown {
  const { route } = scenario.focusedRoute();
  if (route.name !== WORKSPACE_ROUTE_NAME) {
    return route.name;
  }
  return (route.params as { workspaceId?: unknown } | undefined)?.workspaceId;
}

const NOTIFIED_AGENT_TAB: OpenedTab = {
  workspaceKey: `${SERVER_ID}:${WORKSPACE_ID}`,
  target: { kind: "agent", agentId: AGENT_ID },
  pin: true,
};

describe("the first notification tap after pairing through a link", () => {
  it("opens the notified agent when the host directory comes back online", async () => {
    const app = openFreshApp();
    pairFirstHostThroughLink(app);
    expect(app.rootStack()).toEqual(["welcome", "*open-project"]);

    await tapPermissionNotificationAfterBackground(app);
    // An uncached agent enters via NAVIGATE, retaining Open Project beneath the host route.
    // The old workspace POP_TO handoff replaced it when the host was not mounted yet.
    expect(app.rootStack()).toEqual(["welcome", "open-project", "*h/[serverId]"]);
    expect(focusedWorkspaceId(app)).toBe(AGENT_ROUTE_NAME);

    app.setAnyOnlineHost(SERVER_ID);
    expect(focusedWorkspaceId(app)).toBe(AGENT_ROUTE_NAME);
    expect(app.openedTabs).toEqual([]);

    app.directoryArrives([WORKSPACE_ID], [{ id: AGENT_ID, workspaceId: WORKSPACE_ID }]);
    expect(app.rootStack()).toEqual(["welcome", "open-project", "*h/[serverId]"]);
    expect(focusedWorkspaceId(app)).toBe(WORKSPACE_ID);
    expect(app.lastWorkspaceId()).toBe(WORKSPACE_ID);
    expect(app.openedTabs).toEqual([NOTIFIED_AGENT_TAB]);
  });

  // Regression witness for the old unfocused welcome effect seen in the Android run. With the
  // current agent-only notification target, it steals the pending agent route before the directory
  // can resolve its workspace, so no workspace is remembered and the agent tab never opens.
  it("witness: an unfocused welcome effect replaces the pending agent route", async () => {
    const app = openFreshApp(welcomeEffectLikeUpstream);
    pairFirstHostThroughLink(app);
    // Before the run the tester opened Settings from the sidebar and left it with the back arrow:
    // with no remembered workspace, returnFromSettings replaces Settings with /open-project.
    app.push("/settings");
    app.replace("/open-project");
    await tapPermissionNotificationAfterBackground(app);
    expect(app.rootStack()).toEqual(["welcome", "open-project", "open-project", "*h/[serverId]"]);
    expect(focusedWorkspaceId(app)).toBe(AGENT_ROUTE_NAME);
    expect(app.openedTabs).toEqual([]);

    app.setAnyOnlineHost(SERVER_ID);
    expect(app.focusedRoute().route.name).toBe("open-project");
    app.directoryArrives([WORKSPACE_ID], [{ id: AGENT_ID, workspaceId: WORKSPACE_ID }]);

    expect(app.rootStack()).toEqual(["welcome", "open-project", "open-project", "*open-project"]);
    expect(app.focusedRoute().route.name).toBe("open-project");
    expect(app.lastWorkspaceId()).toBeNull();
    expect(app.openedTabs).toEqual([]);
  });
});

describe("the welcome screen moving on to the host", () => {
  it("moves on to Open Project when a host comes online while it shows", () => {
    const app = openFreshApp();

    app.setAnyOnlineHost(SERVER_ID);

    expect(app.rootStack()).toEqual(["*open-project"]);
  });

  it("leaves the screen above it alone, and moves on once it shows again", () => {
    const app = openFreshApp();
    // The welcome screen's Settings button; a host added there connects.
    app.push("/settings");
    app.setAnyOnlineHost(SERVER_ID);
    expect(app.rootStack()).toEqual(["welcome", "*settings/index"]);

    app.back();

    expect(app.rootStack()).toEqual(["*open-project"]);
  });
});
