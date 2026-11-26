/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import type { ProviderAuthStatus } from "@getpaseo/protocol/woowtech-provider-auth";
import { i18n } from "@/i18n/i18next";

const snapshot = vi.hoisted(() => ({ entries: [] as ProviderSnapshotEntry[] }));
const layout = vi.hoisted(() => ({ compact: false }));
vi.mock("@/hooks/use-providers-snapshot", () => ({
  useProvidersSnapshot: () => ({ entries: snapshot.entries, isLoading: false }),
}));
vi.mock("@/runtime/host-runtime", () => ({ useHostRuntimeIsConnected: () => true }));
vi.mock("@/components/provider-installation", () => ({
  useProviderInstallation: () => ({
    state: { status: "unsupported" },
    updates: { status: "hidden" },
    action: undefined,
  }),
}));
vi.mock("./provider-config", () => ({
  useProviderConfigActions: () => ({ setEnabled: () => {}, togglingProviderId: null }),
}));
vi.mock("./provider-glyph", () => ({ ProviderGlyph: () => null }));
vi.mock("./add-provider-sheet", () => ({ AddProviderSheet: () => null }));
vi.mock("@/constants/layout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/layout")>()),
  useIsCompactFormFactor: () => layout.compact,
}));

let list: typeof import("./provider-list");
beforeAll(async () => {
  vi.stubGlobal("React", React);
  list = await import("./provider-list");
});
beforeEach(() => vi.stubGlobal("React", React));
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  layout.compact = false;
  snapshot.entries = [];
  await i18n.changeLanguage("en");
});

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

function onOpenProvider() {}

function renderList() {
  render(<list.ProviderList serverId="host-1" onOpenProvider={onOpenProvider} />);
}

function row(provider: string) {
  return within(screen.getByTestId(`provider-row-${provider}`));
}

describe("provider login state in the new settings list", () => {
  it.each([false, true])(
    "keeps Traditional Chinese login guidance and accessible names (compact=%s)",
    async (compact) => {
      layout.compact = compact;
      await i18n.changeLanguage("zh-TW");
      snapshot.entries = [
        claude("claude", "Claude", { state: "needs_login" }),
        claude("work", "Work", { state: "configured", method: "api_key" }),
        claude("old", "Old host"),
      ];
      renderList();

      const hint = "需要登入：請在主機上執行 claude auth login，或設定 API key。";
      expect(
        row("claude").getByText(new RegExp(hint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))),
      ).toBeTruthy();
      expect(
        row("claude").getByRole("button", { name: `Claude 供應商詳情，${hint}` }),
      ).toBeTruthy();
      expect(row("work").getByText(/使用 API key（按用量計費），不是 Claude 訂閱/)).toBeTruthy();
      expect(row("old").getByRole("button", { name: "Old host 供應商詳情" })).toBeTruthy();
      expect(row("old").queryByText(/登入|API key/)).toBeNull();
    },
  );

  it("distinguishes a subscription, token, and unknown login without losing the model count", () => {
    snapshot.entries = [
      claude("claude", "Claude", { state: "signed_in", method: "subscription" }),
      claude("zai", "Z.AI", { state: "configured", method: "auth_token" }),
      claude("bedrock", "Bedrock", { state: "unknown", method: "cloud_provider" }),
    ];
    renderList();
    expect(row("claude").getByText(/Signed in with a Claude subscription.*1 model/)).toBeTruthy();
    expect(row("zai").getByText(/ANTHROPIC_AUTH_TOKEN/)).toBeTruthy();
    expect(row("bedrock").getByText(/Login status unknown/)).toBeTruthy();
  });

  it.each(["disabled", "loading", "error"] as const)(
    "does not let stale auth replace a provider's %s state",
    (state) => {
      snapshot.entries = [
        {
          ...claude("claude", "Claude", { state: "needs_login" }),
          enabled: state !== "disabled",
          status: state === "disabled" ? "ready" : state,
          error: state === "error" ? "Provider failed" : undefined,
        },
      ];
      renderList();
      expect(row("claude").queryByText(/Login required|claude auth login/)).toBeNull();
      expect(row("claude").getByRole("button", { name: "Claude provider details" })).toBeTruthy();
    },
  );
});
