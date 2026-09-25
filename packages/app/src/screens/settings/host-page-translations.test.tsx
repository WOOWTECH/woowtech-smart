/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import React, { type ReactElement } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";

const host = vi.hoisted(() => ({
  profile: { serverId: "host-1", label: "Mac", connections: [] },
  config: {
    relay: { enabled: false },
    mcp: { injectIntoAgents: false },
    browserTools: { enabled: false },
    providers: {},
    metadataGeneration: { providers: [] },
    autoArchiveAfterMerge: false,
    enableTerminalAgentHooks: false,
    appendSystemPrompt: "",
    terminalProfiles: [],
  },
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => [host.profile],
  useHostRuntimeIsConnected: () => true,
  useHostRuntimeClient: () => null,
  useHostRuntimeSnapshot: () => null,
  useHostMutations: () => ({}),
  getHostRuntimeStore: () => ({ getSnapshot: () => null }),
  isHostRuntimeConnected: () => true,
}));

vi.mock("@/hooks/use-daemon-config", () => ({
  useDaemonConfig: () => ({
    config: host.config,
    isLoading: false,
    patchConfig: async () => host.config,
  }),
}));

vi.mock("@/components/adaptive-modal-sheet", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");
  return {
    AdaptiveModalSheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
      visible ? ReactModule.createElement("div", { role: "dialog" }, children) : null,
    AdaptiveTextInput: () => null,
  };
});

// The settings switches animate their colors; the test theme has none to animate.
vi.mock("react-native-reanimated", () => ({
  default: { View: "div" },
  Keyframe: class {
    duration() {
      return this;
    }
  },
  Easing: { ease: "ease", inOut: (value: unknown) => value },
  interpolateColor: (value: number, _input: number[], output: string[]) =>
    value >= 1 ? output[1] : output[0],
  useAnimatedStyle: (factory: () => unknown) => factory(),
  useDerivedValue: (factory: () => unknown) => ({ value: factory() }),
  withTiming: (value: unknown) => value,
}));

// Sections these pages do not render here, whose dependencies vitest cannot parse.
vi.mock("@/agent-profiles", () => ({ AgentProfilesSection: () => null }));
vi.mock("@/agent-skills", () => ({ AgentSkillsSection: () => null }));
vi.mock("@/desktop/components/desktop-updates-section", () => ({ LocalDaemonSection: () => null }));
vi.mock("@/desktop/components/pair-device-modal", () => ({ PairDeviceModal: () => null }));

// host-page's JSX compiles to React.createElement, some of it at module scope, so
// React has to be global before the page loads.
let pages: typeof import("./host-page");
let browserTools: typeof import("./browser-tools-card");

beforeAll(async () => {
  vi.stubGlobal("React", React);
  pages = await import("./host-page");
  browserTools = await import("./browser-tools-card");
}, 120_000);

beforeEach(async () => {
  vi.stubGlobal("React", React);
  await i18n.changeLanguage("zh-TW");
});

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

function renderPage(page: ReactElement): void {
  render(<QueryClientProvider client={new QueryClient()}>{page}</QueryClientProvider>);
}

describe("host settings in Traditional Chinese", () => {
  it("explains the terminal agent hooks in Chinese", () => {
    renderPage(<pages.HostTerminalsPage serverId="host-1" />);

    expect(screen.getByText("終端機 Agent")).toBeTruthy();
    expect(screen.getByText("啟用終端機 Agent hooks")).toBeTruthy();
    expect(
      screen.getByText("接收終端機 Agent 的通知和狀態。這會在你的 Agent 設定檔中安裝 hooks。"),
    ).toBeTruthy();
    expect(screen.getByLabelText("啟用終端機 Agent hooks")).toBeTruthy();
    expect(screen.queryByText(/terminal agent/i)).toBeNull();
    // Upstream's own strings on this page, which its Simplified Chinese leaves in English.
    expect(screen.getByText("終端機設定檔")).toBeTruthy();
    expect(screen.getByText("還沒有設定檔。新增一個，就能用指定的指令啟動終端機。")).toBeTruthy();
  });

  it("describes archiving merged pull request workspaces in Chinese", () => {
    renderPage(<pages.HostWorkspacesPage serverId="host-1" />);

    expect(screen.getByText("封存 PR 已合併的工作區")).toBeTruthy();
    expect(screen.getByText("PR 合併後，自動封存沒有未提交變更的渥屋智能工作區")).toBeTruthy();
    expect(screen.getByLabelText("封存 PR 已合併的工作區")).toBeTruthy();
    expect(screen.queryByText(/archive/i)).toBeNull();
  });

  it("warns about browser tools in Chinese", () => {
    renderPage(<browserTools.BrowserToolsOptInCard serverId="host-1" />);

    expect(screen.getByText("瀏覽器工具")).toBeTruthy();
    expect(
      screen.getByText(
        "允許 Agent 存取並控制渥屋智能的瀏覽器分頁，包括已登入的瀏覽器狀態。只對你信任的 Agent 開啟。",
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText("啟用瀏覽器工具")).toBeTruthy();
    expect(screen.queryByText(/browser/i)).toBeNull();
  });
});
