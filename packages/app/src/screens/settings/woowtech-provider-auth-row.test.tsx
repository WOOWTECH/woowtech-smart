/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import type { ProviderAuthStatus } from "@getpaseo/protocol/woowtech-provider-auth";
import { i18n } from "@/i18n/i18next";

// woowtech smart: the provider list renders Claude's login state (woowtech/README.md §3), in
// Traditional Chinese and in English. Only the host's data and the widgets that need a native
// runtime are stand-ins; the rows, the text and the translations are the app's own.

const snapshot = vi.hoisted(() => ({ entries: [] as unknown[] }));

vi.mock("@/hooks/use-providers-snapshot", () => ({
  useProvidersSnapshot: () => ({
    entries: snapshot.entries,
    isLoading: false,
    isFetching: false,
    isRefreshing: false,
    error: null,
    supportsSnapshot: true,
    refresh: async () => {},
    refetchIfStale: () => {},
  }),
}));
vi.mock("@/hooks/use-daemon-config", () => ({
  useDaemonConfig: () => ({ config: null, isLoading: false, patchConfig: async () => null }),
}));
vi.mock("@/runtime/host-runtime", () => ({ useHostRuntimeIsConnected: () => true }));
vi.mock("@/runtime/host-features", () => ({ useHostFeature: () => false }));
vi.mock("@/components/provider-catalog-list", () => ({ ProviderCatalogList: () => null }));
vi.mock("@/stores/provider-settings-store", () => ({
  useProviderSettingsStore: (select: (state: { open: () => void }) => unknown) =>
    select({ open: () => {} }),
}));
vi.mock("@/components/provider-icons", () => ({ getProviderIcon: () => () => null }));
vi.mock("@/components/ui/switch", () => ({ Switch: () => null }));
vi.mock("@/components/ui/loading-spinner", () => ({ LoadingSpinner: () => null }));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: () => null,
  DropdownMenuContent: () => null,
  DropdownMenuItem: () => null,
  DropdownMenuTrigger: () => null,
}));
vi.mock("@/utils/confirm-dialog", () => ({ confirmDialog: async () => false }));
// A phone's compact rows or a desktop's wide ones.
const layout = vi.hoisted(() => ({ compact: false }));
vi.mock("@/constants/layout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/layout")>()),
  useIsCompactFormFactor: () => layout.compact,
}));

function claude(provider: string, label: string, auth?: ProviderAuthStatus): ProviderSnapshotEntry {
  return {
    provider,
    label,
    status: "ready",
    enabled: true,
    modes: [],
    defaultModeId: null,
    models: [{ provider, id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" }],
    ...(auth ? { auth } : {}),
  };
}

// providers-section's JSX compiles to React.createElement, so React is global before it loads.
let section: typeof import("./providers-section");

beforeAll(async () => {
  vi.stubGlobal("React", React);
  section = await import("./providers-section");
}, 120_000);

beforeEach(() => {
  vi.stubGlobal("React", React);
});

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  layout.compact = false;
  await i18n.changeLanguage("en");
});

function row(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

describe("the provider list in Traditional Chinese", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-TW");
  });

  it("says Claude needs a login and how to log in, and keeps the others", () => {
    snapshot.entries = [
      claude("claude", "Claude", { state: "needs_login" }),
      claude("zai", "Z.AI", { state: "configured", method: "auth_token" }),
      claude("work", "Work", { state: "configured", method: "api_key" }),
      claude("old", "Old host"),
    ];
    render(<section.ProvidersSection serverId="host-1" />);

    const signedOut = within(row("Claude 供應商詳情"));
    expect(signedOut.getByText("需要登入")).toBeTruthy();
    expect(signedOut.getByText("請在主機上執行 claude auth login，或設定 API key。")).toBeTruthy();
    expect(signedOut.queryByText("可用")).toBeNull();
    // The wide row shows the label itself; its dot stays a plain dot.
    expect(signedOut.queryByRole("img")).toBeNull();

    const token = within(row("Z.AI 供應商詳情"));
    expect(token.getByText("可用")).toBeTruthy();
    expect(token.getByText("已設定 ANTHROPIC_AUTH_TOKEN")).toBeTruthy();

    const apiKey = within(row("Work 供應商詳情"));
    expect(apiKey.getByText("可用")).toBeTruthy();
    expect(apiKey.getByText("使用 API key（按用量計費），不是 Claude 訂閱")).toBeTruthy();

    // An entry from a daemon without the login state shows as it did before.
    const old = within(row("Old host 供應商詳情"));
    expect(old.getByText("可用")).toBeTruthy();
    expect(old.queryByText(/登入|API key|已設定/)).toBeNull();
  });
});

describe("the provider list in English", () => {
  it("shows the subscription and an unknown login state", () => {
    snapshot.entries = [
      claude("claude", "Claude", { state: "signed_in", method: "subscription" }),
      claude("bedrock", "Bedrock", { state: "unknown", method: "cloud_provider" }),
    ];
    render(<section.ProvidersSection serverId="host-1" />);

    const subscription = within(row("Claude provider details"));
    expect(subscription.getByText("Available")).toBeTruthy();
    expect(subscription.getByText("Signed in with a Claude subscription")).toBeTruthy();

    const cloud = within(row("Bedrock provider details"));
    expect(cloud.getByText("Available")).toBeTruthy();
    expect(cloud.getByText("Login status unknown")).toBeTruthy();
  });
});

// A phone's row hides the status label and draws only the dot. The line under the name starts
// with the label when a login is needed, the dot says the login state, and so does the row's
// name: VoiceOver reads the whole row as one button, not the dot or the line inside it.
describe("the provider list on a phone", () => {
  beforeEach(() => {
    layout.compact = true;
  });

  it("says Claude needs a login in the line, the dot and the row's name, in Traditional Chinese", async () => {
    await i18n.changeLanguage("zh-TW");
    snapshot.entries = [
      claude("claude", "Claude", { state: "needs_login" }),
      claude("work", "Work", { state: "signed_in", method: "subscription" }),
      claude("old", "Old host"),
    ];
    render(<section.ProvidersSection serverId="host-1" />);

    const line = "需要登入：請在主機上執行 claude auth login，或設定 API key。";
    const signedOut = within(row(`Claude 供應商詳情，${line}`));
    expect(signedOut.getByText(line)).toBeTruthy();
    expect(signedOut.getByRole("img", { name: "需要登入" })).toBeTruthy();

    const subscription = within(row("Work 供應商詳情，已使用 Claude 訂閱登入"));
    expect(subscription.getByText("已使用 Claude 訂閱登入")).toBeTruthy();
    expect(subscription.getByRole("img", { name: "已使用 Claude 訂閱登入" })).toBeTruthy();

    // An entry from a daemon without the login state shows as it did before.
    const old = within(row("Old host 供應商詳情"));
    expect(old.queryByRole("img")).toBeNull();
    expect(old.queryByText(/登入|API key|已設定/)).toBeNull();
  });

  it("says it in English", () => {
    snapshot.entries = [
      claude("claude", "Claude", { state: "needs_login" }),
      claude("work", "Work", { state: "configured", method: "api_key" }),
    ];
    render(<section.ProvidersSection serverId="host-1" />);

    const line = "Login required: Run claude auth login on the host, or set an API key.";
    const signedOut = within(row(`Claude provider details, ${line}`));
    expect(signedOut.getByText(line)).toBeTruthy();
    expect(signedOut.getByRole("img", { name: "Login required" })).toBeTruthy();

    const apiKey = "Uses an API key (billed per use), not a Claude subscription";
    const billed = within(row(`Work provider details, ${apiKey}`));
    expect(billed.getByText(apiKey)).toBeTruthy();
    expect(billed.getByRole("img", { name: apiKey })).toBeTruthy();
  });
});
