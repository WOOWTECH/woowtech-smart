import { describe, expect, it } from "vitest";
import { buildHostWorkspaceOpenRoute } from "@/utils/host-routes";
import { buildNotificationRoute, resolveNotificationTarget } from "./notification-routing";

// woowtech smart push (fork-owned): a tapped push from WoowTech's relay reaches
// notification-routing.ts in two shapes. These tests lock that both still open the agent or
// terminal, so notification-routing.ts needs no fork change.

const SERVER_ID = "srv_Ab3dEf9hIjK_";
const WORKSPACE_ID = "wks_0123456789abcdef";
const AGENT_ID = "1b4e28ba-2fa1-41d2-883f-0016d3cca427";
const TERMINAL_ID = "9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f";

// The relay's FCM `data` and iOS `apns.payload.body` carry the same string fields (push design
// 5.6; the relay's smart-payload.js), with either agentId or terminalId.
function relayData(target: { agentId: string } | { terminalId: string }): Record<string, string> {
  return {
    v: "1",
    reason: "finished",
    serverId: SERVER_ID,
    workspaceId: WORKSPACE_ID,
    ...target,
  };
}

// Android, app in the background: the FCM SDK shows the push, and the tap's launch intent
// carries the data keys among FCM's own extras. expo-notifications passes the extras through as
// content.data when their "body" is not JSON (NotificationSerializer.toResponseBundleFromExtras).
function androidTapData(target: { agentId: string } | { terminalId: string }) {
  return {
    "google.delivered_priority": "high",
    "google.sent_time": 1727251200000,
    "google.ttl": 3600,
    "google.original_priority": "high",
    "google.message_id": "0:1727251200000000%31bd1c9631bd1c96",
    from: "817759088520",
    collapse_key: "io.woowtech.smart",
    ...relayData(target),
  };
}

// iOS: expo-notifications reads a remote push's data from userInfo["body"] only, which is where
// the relay puts the ids (apns.payload.body).
function iosTapData(target: { agentId: string } | { terminalId: string }) {
  return relayData(target);
}

describe("tapping a woowtech push", () => {
  it("opens the agent from an Android tap", () => {
    const data = androidTapData({ agentId: AGENT_ID });

    expect(resolveNotificationTarget(data)).toEqual({
      serverId: SERVER_ID,
      workspaceId: WORKSPACE_ID,
      agentId: AGENT_ID,
      terminalId: null,
    });
    expect(buildNotificationRoute(data)).toBe(
      buildHostWorkspaceOpenRoute(SERVER_ID, WORKSPACE_ID, `agent:${AGENT_ID}`),
    );
  });

  it("opens the agent from an iOS tap", () => {
    const data = iosTapData({ agentId: AGENT_ID });

    expect(resolveNotificationTarget(data)).toEqual({
      serverId: SERVER_ID,
      workspaceId: WORKSPACE_ID,
      agentId: AGENT_ID,
      terminalId: null,
    });
    expect(buildNotificationRoute(data)).toBe(
      buildHostWorkspaceOpenRoute(SERVER_ID, WORKSPACE_ID, `agent:${AGENT_ID}`),
    );
  });

  it("opens the terminal from an Android or iOS tap", () => {
    const terminalRoute = buildHostWorkspaceOpenRoute(
      SERVER_ID,
      WORKSPACE_ID,
      `terminal:${TERMINAL_ID}`,
    );

    expect(buildNotificationRoute(androidTapData({ terminalId: TERMINAL_ID }))).toBe(terminalRoute);
    expect(buildNotificationRoute(iosTapData({ terminalId: TERMINAL_ID }))).toBe(terminalRoute);
  });

  it("opens the app's start from the relay's daily-limit notice, which names no host", () => {
    expect(buildNotificationRoute({ v: "1", reason: "daily_limit" })).toBe("/");
  });
});
