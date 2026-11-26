import { describe, expect, it, vi } from "vitest";
import { createNotificationOpenRouter } from "@/notification-open";
import type { NotificationTap } from "@/notification-open";

// woowtech smart push (fork-owned): a tapped push from WoowTech's relay reaches
// notification-open in two shapes. Agents resolve their current workspace through navigation;
// terminal targets retain the workspace carried by the relay.

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

async function openRelayTap(data: NotificationTap["data"]) {
  const openAgent = vi.fn();
  const openTerminal = vi.fn();
  const openRoute = vi.fn();
  let acknowledge = () => {};
  const dispatched = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  const router = createNotificationOpenRouter({
    source: {
      subscribe: () => () => {},
      takeLaunchTap: async () => ({ id: "relay-delivery", data }),
      acknowledge: () => acknowledge(),
    },
    openAgent,
    openTerminal,
    openRoute,
    whenReadyToNavigate: () => Promise.resolve(),
  });
  const stop = router.start();
  await dispatched;
  stop();
  return { openAgent, openTerminal, openRoute };
}

describe("tapping a woowtech push", () => {
  it.each([
    ["Android", androidTapData],
    ["iOS", iosTapData],
  ] as const)(
    "opens the agent from an %s tap without trusting the old workspace hint",
    async (_platform, tapData) => {
      const opened = await openRelayTap(tapData({ agentId: AGENT_ID }));
      expect(opened.openAgent).toHaveBeenCalledExactlyOnceWith({
        serverId: SERVER_ID,
        agentId: AGENT_ID,
      });
      expect(opened.openTerminal).not.toHaveBeenCalled();
      expect(opened.openRoute).not.toHaveBeenCalled();
    },
  );

  it.each([androidTapData, iosTapData])("opens the terminal in its workspace", async (tapData) => {
    const opened = await openRelayTap(tapData({ terminalId: TERMINAL_ID }));
    expect(opened.openTerminal).toHaveBeenCalledExactlyOnceWith({
      kind: "terminal",
      serverId: SERVER_ID,
      workspaceId: WORKSPACE_ID,
      terminalId: TERMINAL_ID,
    });
    expect(opened.openAgent).not.toHaveBeenCalled();
    expect(opened.openRoute).not.toHaveBeenCalled();
  });

  it("acknowledges a daily-limit notice without replacing the current screen", async () => {
    const opened = await openRelayTap({ v: "1", reason: "daily_limit" });
    expect(opened.openAgent).not.toHaveBeenCalled();
    expect(opened.openTerminal).not.toHaveBeenCalled();
    expect(opened.openRoute).not.toHaveBeenCalled();
  });
});
