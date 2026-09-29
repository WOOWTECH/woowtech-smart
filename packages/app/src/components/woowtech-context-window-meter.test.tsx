/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";

// woowtech smart: account usage stays hidden (woowtech/README.md section 23). Opening the
// context meter's tooltip shows the session's own context, tokens and cost, and never asks
// the host for provider usage, even from a host that still advertises it. Only the host's
// data and the popover are stand-ins; the meter and its text are the app's own.

const host = vi.hoisted(() => ({
  listProviderUsage: vi.fn(async () => ({
    requestId: "usage-1",
    fetchedAt: "2026-09-29T00:00:00.000Z",
    providers: [
      {
        providerId: "claude",
        displayName: "Claude",
        status: "available",
        planLabel: "Max 20x",
        windows: [{ id: "session", label: "Session", usedPct: 42 }],
      },
    ],
  })),
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => ({ listProviderUsage: host.listProviderUsage }),
  useHostRuntimeIsConnected: () => true,
}));

vi.mock("@/stores/session-store", () => ({
  useSessionStore: (select: (state: unknown) => unknown) =>
    select({ sessions: { "host-1": { serverInfo: { features: { providerUsageList: true } } } } }),
}));

// The real popover measures a native layout. This one shows its content while open and
// opens the way a hover or tap does, through onOpenChange.
vi.mock("@/components/ui/tooltip", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");
  const Open = ReactModule.createContext(false);
  return {
    Tooltip: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      children: React.ReactNode;
    }) =>
      ReactModule.createElement(
        Open.Provider,
        { value: open },
        ReactModule.createElement(
          "button",
          { type: "button", onClick: () => onOpenChange(true) },
          "Open tooltip",
        ),
        children,
      ),
    TooltipTrigger: ({ children }: { children: React.ReactNode }) => children,
    TooltipContent: ({ children }: { children: React.ReactNode }) =>
      ReactModule.useContext(Open)
        ? ReactModule.createElement("div", { role: "tooltip" }, children)
        : null,
  };
});

// The meter's JSX compiles to React.createElement, so React has to be global before it loads.
let meter: typeof import("./context-window-meter");

beforeAll(async () => {
  vi.stubGlobal("React", React);
  meter = await import("./context-window-meter");
}, 120_000);

beforeEach(async () => {
  vi.stubGlobal("React", React);
  host.listProviderUsage.mockClear();
  await i18n.changeLanguage("en");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderMeter(): void {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <meter.ContextWindowMeter
        maxTokens={200_000}
        usedTokens={50_000}
        totalCostUsd={0.42}
        serverId="host-1"
        provider="claude"
      />
    </QueryClientProvider>,
  );
}

async function openTooltip(): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(screen.getByText("Open tooltip"));
  });
  // Give a usage request, if one were sent, the time to resolve and render.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return screen.getByRole("tooltip");
}

describe("context window meter with account usage hidden", () => {
  it("keeps the ring with its percentage", () => {
    renderMeter();

    expect(screen.getByTestId("context-window-meter").getAttribute("aria-label")).toBe(
      "Context window 25% used",
    );
  });

  it("opens to the session's context, tokens and cost without asking the host for usage", async () => {
    renderMeter();

    const tooltip = await openTooltip();

    expect(tooltip.textContent).toBe("Context window25% used50k / 200k tokensSession cost $0.42");
    expect(host.listProviderUsage).not.toHaveBeenCalled();
  });
});
