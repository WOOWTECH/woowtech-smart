import type { PluginClientContext } from "@getpaseo/plugin/client";
import { settingsRpc } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// Exercise the real contribution, settings sync, and board registration. Rendering
// and the lazy chunk transport are boundaries here; no browser or daemon is started.
vi.mock("react-native", () => ({
  Platform: { OS: "web" },
  NativeModules: {},
  TurboModuleRegistry: { get: () => null },
  Dimensions: { get: () => ({ width: 1200, height: 800 }) },
}));
vi.mock("./client/tasks/device-preferences", async () => {
  const { createDeviceTasksStore } = await import("./client/tasks/device-store");
  let saved: string | null = null;
  const store = createDeviceTasksStore({
    read: () => saved,
    write: (value) => {
      saved = value;
    },
  });
  return { deviceTasksStore: () => store };
});
vi.mock("./client/tasks/chunk/load", () => ({
  TasksBoardScreen: () => null,
  TasksSidebarEntry: () => null,
  BetterPaseoSettingsPage: () => null,
  setChunkClient: vi.fn(),
  chunkNow: () => null,
  requestChunk: vi.fn(),
  requestChunkLater: vi.fn(),
  cancelChunkLater: vi.fn(),
  subscribeChunk: () => () => {},
}));
vi.mock("./client/live-renderers", () => ({
  LiveToolCallRenderer: () => null,
  LiveReasoningRenderer: () => null,
  LiveTodoRenderer: () => null,
  LiveUserMessageRenderer: () => null,
  LiveNoticeRenderer: () => null,
  LiveAssistantRenderer: () => null,
}));
vi.mock("./client/components/embed-fonts", () => ({
  setEmbeddedFontLoader: vi.fn(),
  removeEmbeddedFonts: vi.fn(),
}));
vi.mock("./client/components/marks", () => ({ setMarkLoader: vi.fn() }));
vi.mock("./client/components/chat-find", () => ({ installChatFind: () => () => {} }));
vi.mock("./client/components/focus-ring", () => ({ installPointerFocusRing: () => () => {} }));
vi.mock("./client/plugin-update-indicator", () => ({ PluginUpdateIndicator: () => null }));
vi.mock("./client/timeline-level-menu", () => ({ TimelineLevelMenu: () => null }));

type Screen = Parameters<PluginClientContext["addScreen"]>[0];
type Sidebar = Parameters<PluginClientContext["addSidebarHeaderItem"]>[0];
type Command = Parameters<PluginClientContext["addCommandCenterItem"]>[0];
type SettingsScreen = Parameters<PluginClientContext["addSettingsScreen"]>[0];
type Changed = {
  type: "status";
  payload: { status: "plugin_settings_changed"; settingsId: string };
};

function registry<T extends { id: string }>() {
  const entries = new Map<string, T>();
  return {
    entries,
    add(value: T) {
      if (entries.has(value.id)) throw new Error(`Duplicate registration: ${value.id}`);
      entries.set(value.id, value);
      return () => {
        entries.delete(value.id);
      };
    },
  };
}

function host(options: { tasks?: unknown; presentation?: unknown; failTasks?: boolean } = {}) {
  const screens = registry<Screen>();
  const sidebar = registry<Sidebar>();
  const commands = registry<Command>();
  const settings = registry<SettingsScreen>();
  const transformers = registry<{ id: string }>();
  const pills = new Set<string>();
  const observers = new Set<(event: Changed) => void>();
  const openScreen = vi.fn();
  const openSettings = vi.fn();
  const agents = vi.fn(async () => ({
    entries: [{ agent: { id: "agent-a", workspaceId: "workspace-a" } }],
  }));
  let presentation: unknown = options.presentation ?? {};
  let revision = 1;
  const rpc = vi.fn(async (contract: { name: string }) => {
    if (contract.name === settingsRpc("tasks").read.name) {
      if (options.failTasks) throw new Error("host unavailable");
      return { status: "ready", revision: "missing", values: options.tasks ?? {} };
    }
    if (contract.name === settingsRpc("presentation").read.name) {
      return { status: "ready", revision: String(revision), values: presentation };
    }
    if (contract.name === "tasks.title-language") return { ok: true };
    throw new Error(`Unexpected RPC: ${contract.name}`);
  });
  const client = {
    rpc,
    openScreen,
    openSettings,
    addScreen: screens.add,
    addSidebarHeaderItem: sidebar.add,
    addCommandCenterItem: commands.add,
    addSettingsScreen: settings.add,
    addTimelineTransformer: transformers.add,
    addTimelineRenderer: () => () => {},
    addSlashCommand: () => () => {},
    addComposerPill: (value: { agentId: string }) => {
      pills.add(value.agentId);
      return {
        update: () => {},
        remove: () => {
          pills.delete(value.agentId);
        },
      };
    },
    paseo: {
      agents: { list: agents },
      observeEvents: () => ({
        subscribe: ({ update }: { update: (event: Changed) => void }) => {
          observers.add(update);
          return () => {
            observers.delete(update);
          };
        },
        release: async () => {},
      }),
    },
  } as unknown as PluginClientContext;
  return {
    client,
    screens: screens.entries,
    sidebar: sidebar.entries,
    commands: commands.entries,
    settings: settings.entries,
    transformers: transformers.entries,
    pills,
    observers,
    openScreen,
    openSettings,
    agents,
    rpc,
    changePresentation(values: unknown) {
      presentation = values;
      revision++;
      for (const update of observers)
        update({
          type: "status",
          payload: { status: "plugin_settings_changed", settingsId: "presentation" },
        });
    },
  };
}

let stop: (() => void) | undefined;
beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.clearAllMocks();
});

async function load() {
  const [{ default: contribute }, preferences, board, language, tabs] = await Promise.all([
    import("./index.client.tsx"),
    import("./client/preferences"),
    import("./client/tasks/board/enabled"),
    import("./client/i18n/host-language"),
    import("./client/settings-tab"),
  ]);
  language.resetHostLanguageForTests({ deviceLocales: () => ["en-US"], nativeRead: null });
  return { contribute, preferences, board, language, tabs };
}

test("a new host offers the real Tasks screen and settings while leaving chat native", async () => {
  const runtime = await load();
  const app = host();
  stop = runtime.contribute(app.client);
  expect(app.screens.has("tasks")).toBe(true);
  await vi.waitFor(() => expect(app.sidebar.get("tasks")?.title).toBe("Tasks"));
  expect(runtime.board.tasksStartupRead()).toBe("done");
  expect(app.settings.has("chat-presentation")).toBe(true);
  expect(app.commands.has("open-tasks")).toBe(true);
  expect(app.transformers.size).toBe(0);
  expect(app.pills.size).toBe(0);
  expect(app.agents).not.toHaveBeenCalled();
  runtime.board.tasksBoardOpener()?.();
  expect(app.openScreen).toHaveBeenCalledWith({ screenId: "tasks", params: {} });
  runtime.board.tasksSettingsOpener()?.();
  expect(app.openSettings).toHaveBeenCalledWith("chat-presentation");
  expect(runtime.tabs.settingsTab()).toBe("tasks");
  stop();
  stop = undefined;
  expect([
    app.screens.size,
    app.sidebar.size,
    app.commands.size,
    app.settings.size,
    app.observers.size,
  ]).toEqual([0, 0, 0, 0, 0]);
});

test("saved board-off settings remain off and live toggles remove and restore entry points", async () => {
  const runtime = await load();
  const app = host({ tasks: { enabled: false } });
  stop = runtime.contribute(app.client);
  await vi.waitFor(() => expect(runtime.board.tasksStartupRead()).toBe("done"));
  expect([app.screens.size, app.sidebar.size, app.commands.size]).toEqual([1, 0, 0]);
  runtime.board.setTasksEnabled(true);
  expect([app.sidebar.size, app.commands.size]).toEqual([1, 1]);
  runtime.board.setTasksEnabled(false);
  expect([app.sidebar.size, app.commands.size, app.transformers.size]).toEqual([0, 0, 0]);
});

test("an unavailable settings read keeps board navigation available without claiming the board is enabled", async () => {
  const runtime = await load();
  const app = host({ failTasks: true });
  stop = runtime.contribute(app.client);
  await vi.waitFor(() => expect(runtime.board.tasksStartupRead()).toBe("failed"));
  expect(app.screens.has("tasks")).toBe(true);
  expect([app.sidebar.size, app.commands.size]).toEqual([0, 0]);
  expect(runtime.board.tasksEnabled()).toBe(null);
});

test("chat opt-in from another client installs transformers and pills; opt-out removes them without disabling Tasks", async () => {
  const runtime = await load();
  const app = host();
  stop = runtime.contribute(app.client);
  await vi.waitFor(() => expect(app.sidebar.size).toBe(1));
  app.changePresentation({ chatEnabled: true });
  await vi.waitFor(() => expect(app.pills.has("agent-a")).toBe(true));
  expect([...app.transformers.keys()].sort()).toEqual([
    "omp-enhanced-assistant",
    "omp-enhanced-compaction",
    "omp-enhanced-error",
    "omp-enhanced-notification",
    "omp-enhanced-reasoning",
    "omp-enhanced-todo",
    "omp-enhanced-tool-call",
    "omp-enhanced-user-message",
  ]);
  app.changePresentation({ chatEnabled: false });
  await vi.waitFor(() => expect(app.transformers.size).toBe(0));
  expect(app.pills.size).toBe(0);
  expect(app.sidebar.has("tasks")).toBe(true);
});

test("saved chat opt-in survives startup and Traditional Chinese labels follow settings changes", async () => {
  const runtime = await load();
  const app = host({ presentation: { chatEnabled: true, language: "zh-TW" } });
  stop = runtime.contribute(app.client);
  await vi.waitFor(() => expect(app.sidebar.get("tasks")?.title).toBe("任務"));
  expect(app.transformers.size).toBe(8);
  app.changePresentation({ chatEnabled: true, language: "en" });
  await vi.waitFor(() => expect(app.sidebar.get("tasks")?.title).toBe("Tasks"));
  expect(app.commands.size).toBe(1);
  expect(app.settings.size).toBe(1);
});
