import type { PluginClientContext } from "@getpaseo/plugin/client";
import { createElement, type ComponentProps } from "react";
import { lastTurnsRpc } from "../../../shared/turn-usage-rpc";
import {
  tasksLabelsRpc,
  tasksParentOriginsRpc,
  tasksProjectIconsRpc,
  tasksReadsRpc,
  tasksSessionTokensRpc,
  tasksSubagentTimelineRpc,
  tasksSubagentsRpc,
  tasksUnreadClearRpc,
  tasksUnreadsRpc,
} from "../../../shared/tasks-rpc";
import {
  setLabelDefinitionsLoader,
  setLastTurnLoader,
  setParentOriginsLoader,
  setProjectIconsLoader,
  setReadMarksLoader,
  setSubagentLoader,
  setUnreadClearer,
  setUnreadMarksLoader,
} from "../data";
import { setSessionTokensLoader } from "../data/session-tokens";
import { setSubagentTimelineLoader } from "../data/subagent-timeline";
import { conversationSearchRpc } from "../../../shared/conversation-search";
import { setConversationSearchLoader } from "../data/search-conversations";
import { startErrorDismissals } from "../data/error-dismissals";
import { withDeviceSettings } from "../device-preferences";
import { TasksBoardScreen as BoardScreen } from "../board/board-screen";
import { TasksSidebarEntry as SidebarEntry } from "../board/sidebar-entry";
import { TasksSettingsPanel as SettingsPanel } from "../settings/tasks-panel";
import { BetterPaseoSettingsPage as SettingsPage } from "../../settings-page";

/**
 * The Tasks code the board, its sidebar entry and its settings draw with:
 * everything `chunk/load.ts` hands out. In a checkout (and in tests) the
 * main bundle imports this file directly; an install builds it apart
 * (`scripts/build-client.mjs`), the plugin server sends it on request and
 * the client evaluates it (`chunk/remote.ts`), so the board's code stays out
 * of the catalog the app downloads on every reconnect.
 */
const DeviceBoardScreen = withDeviceSettings(BoardScreen);
const DeviceSidebarEntry = withDeviceSettings(SidebarEntry);
const DeviceSettingsPanel = withDeviceSettings(SettingsPanel);
const DeviceSettingsPage = withDeviceSettings(SettingsPage);

// The Hermes interop pass snapshots CommonJS exports before module initialization.
// Export hoisted functions: exporting the wrapper constants captures undefined.
export function TasksBoardScreen(props: ComponentProps<typeof BoardScreen>) {
  return createElement(DeviceBoardScreen, props);
}
export function TasksSidebarEntry(props: ComponentProps<typeof SidebarEntry>) {
  return createElement(DeviceSidebarEntry, props);
}
export { prefetchBoardFromCommand, releaseBoardPrefetch } from "../board/prefetch";
export function TasksSettingsPanel(props: ComponentProps<typeof SettingsPanel>) {
  return createElement(DeviceSettingsPanel, props);
}
// Better Paseo's settings page (chat options and the board's), opened from the host's settings.
export function BetterPaseoSettingsPage(props: ComponentProps<typeof SettingsPage>) {
  return createElement(DeviceSettingsPage, props);
}

/** Points the data layer at this host's plugin server; returns the cleanup. */
export function startTasksData(client: PluginClientContext): () => void {
  const stopErrorDismissals = startErrorDismissals(client);
  // Cards time the last turn from the server's record of it.
  setLastTurnLoader((agentIds) =>
    client.rpc(lastTurnsRpc, { agentIds }).then((result) => result.turns),
  );
  // Provider subagents (Claude's Agent tool) come from the server, which reads them off the daemon.
  setSubagentLoader((since) => client.rpc(tasksSubagentsRpc, since === undefined ? {} : { since }));
  // Cards marked read from a board, failures included: the server keeps the marks.
  setReadMarksLoader(() => client.rpc(tasksReadsRpc, {}).then((result) => result.reads));
  // Cards marked unread from a board: the server keeps the marks, and a done card moves back to review.
  setUnreadMarksLoader(() => client.rpc(tasksUnreadsRpc, {}).then((result) => result.unreads));
  // A task opened from the board was seen: its unread mark goes.
  setUnreadClearer((agentIds) =>
    client.rpc(tasksUnreadClearRpc, { agentIds }).then((result) => {
      if (!result.ok) throw new Error(result.error ?? "tasks.unread-clear failed");
    }),
  );
  // The parent whose archive detached a task, which the server infers as it follows the agents.
  setParentOriginsLoader((since) =>
    client.rpc(tasksParentOriginsRpc, since === undefined ? {} : { since }),
  );
  // Label colors as Paseo's sidebar draws them, for a host whose API lists no label definitions.
  setLabelDefinitionsLoader(() => client.rpc(tasksLabelsRpc, {}).then((result) => result.labels));
  // Project icons as Paseo's sidebar draws them, for a host whose API has no icon call.
  setProjectIconsLoader((projectIds) =>
    client.rpc(tasksProjectIconsRpc, { projectIds }).then((result) => result.icons),
  );
  // A running task's session tokens, read by the server from the provider's session files.
  setSessionTokensLoader((agentId) =>
    client.rpc(tasksSessionTokensRpc, { agentId }).then((result) => result.tokens),
  );
  // A provider subagent's prompt and reply for its details, which the server reads off the daemon.
  setSubagentTimelineLoader((input) => client.rpc(tasksSubagentTimelineRpc, input));
  setConversationSearchLoader((input) => client.rpc(conversationSearchRpc, input));
  return () => {
    stopErrorDismissals();
    setLastTurnLoader(null);
    setSubagentLoader(null);
    setReadMarksLoader(null);
    setUnreadMarksLoader(null);
    setUnreadClearer(null);
    setParentOriginsLoader(null);
    setLabelDefinitionsLoader(null);
    setProjectIconsLoader(null);
    setSessionTokensLoader(null);
    setSubagentTimelineLoader(null);
    setConversationSearchLoader(null);
  };
}
