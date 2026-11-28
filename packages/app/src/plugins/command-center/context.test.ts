import { describe, expect, it } from "vitest";
import { normalizeLayout, type WorkspaceLayout } from "@/stores/workspace-layout-store";
import { getFocusedAgentId, getPluginCommandCenterLocation } from "./context";

function layout(target: import("@/workspace-tabs/model").WorkspaceTabTarget): WorkspaceLayout {
  return normalizeLayout({
    focusedPaneId: "main",
    root: {
      kind: "pane",
      pane: {
        id: "main",
        tabIds: ["focused"],
        focusedTabId: "focused",
        tabs: [{ tabId: "focused", target, createdAt: 1 }],
      },
    },
  });
}

describe("plugin Command Center agent context", () => {
  it("uses the focused agent tab", () => {
    expect(getFocusedAgentId(layout({ kind: "agent", agentId: "agent-1" }))).toBe("agent-1");
  });

  it("preserves agent context while its plugin panel is focused", () => {
    expect(
      getFocusedAgentId(
        layout({
          kind: "plugin",
          pluginId: "review",
          panelId: "details",
          context: "agent",
          agentId: "agent-1",
        }),
      ),
    ).toBe("agent-1");
  });

  it("does not invent agent context for workspace panels", () => {
    expect(
      getFocusedAgentId(
        layout({
          kind: "plugin",
          pluginId: "review",
          panelId: "details",
          context: "workspace",
        }),
      ),
    ).toBeNull();
  });
});

describe("plugin Command Center host context", () => {
  it("offers host actions from a cold settings deep link without a workspace", () => {
    expect(
      getPluginCommandCenterLocation(
        "/settings/hosts/host%2Fone/plugins/better-paseo/chat-presentation",
        null,
      ),
    ).toEqual({ serverId: "host/one", workspaceId: null });
  });
  it("uses the settings host instead of a workspace remembered on another host", () => {
    expect(
      getPluginCommandCenterLocation("/settings/hosts/current/providers", {
        serverId: "earlier",
        workspaceId: "old-workspace",
      }),
    ).toEqual({ serverId: "current", workspaceId: null });
  });
  it("preserves workspace context on a global page", () => {
    expect(
      getPluginCommandCenterLocation("/sessions", {
        serverId: "current",
        workspaceId: "workspace-1",
      }),
    ).toEqual({ serverId: "current", workspaceId: "workspace-1" });
  });
  it("does not use a remembered workspace for another host's screen", () => {
    expect(
      getPluginCommandCenterLocation("/h/current/plugin/better-paseo/surface/tasks", {
        serverId: "earlier",
        workspaceId: "old-workspace",
      }),
    ).toEqual({ serverId: "current", workspaceId: null });
  });
});

it("offers global plugin commands on New before a workspace exists", () => {
  expect(getPluginCommandCenterLocation("/new", null, "first-plugin-host")).toEqual({
    serverId: "first-plugin-host",
    workspaceId: null,
  });
  expect(
    getPluginCommandCenterLocation("/settings/hosts/explicit/providers", null, "first-plugin-host"),
  ).toEqual({ serverId: "explicit", workspaceId: null });
});
