/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";

// A daemon whose relay starts on, as it does in a new woowtech smart home.
const daemon = vi.hoisted(() => ({
  relayEnabled: true,
  patches: [] as unknown[],
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => ({
    getLastServerInfoMessage: () => ({ features: { daemonStatusRpc: true, relayConfig: true } }),
    getDaemonPairingOffer: async () =>
      daemon.relayEnabled
        ? { relayEnabled: true, url: "https://app.paseo.sh/#offer=e30", qr: null }
        : { relayEnabled: false, url: "", qr: null },
  }),
  useHostRuntimeSnapshot: () => ({ connectionStatus: "online" }),
}));

vi.mock("@/hooks/use-daemon-config", () => ({
  useDaemonConfig: () => ({
    config: null,
    isLoading: false,
    patchConfig: async (patch: { relay?: { enabled: boolean } }) => {
      daemon.patches.push(patch);
      if (patch.relay) daemon.relayEnabled = patch.relay.enabled;
      return { relay: { enabled: daemon.relayEnabled } };
    },
  }),
}));

vi.mock("expo-clipboard", () => ({ setStringAsync: async () => undefined }));

let section: typeof import("./pair-device-section");
const closeSheet = () => {};

beforeAll(async () => {
  vi.stubGlobal("React", React);
  section = await import("./pair-device-section");
}, 120_000);

beforeEach(() => {
  vi.stubGlobal("React", React);
  daemon.relayEnabled = true;
  daemon.patches = [];
});

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

function renderPairingScreen(): void {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <section.PairDeviceSection serverId="host-1" onClose={closeSheet} />
    </QueryClientProvider>,
  );
}

// woowtech smart turns the relay on in new homes, so the pairing screen that shows
// its QR code is also where the user turns it off. Turning it back on is upstream's
// consent screen, which shows once the relay is off.
describe("turning the relay off on the desktop pairing screen", () => {
  it("saves relay off and returns to the screen that turns it back on", async () => {
    renderPairingScreen();

    fireEvent.click(await screen.findByText("Turn off relay"));

    expect(await screen.findByText("Enable relay?")).toBeTruthy();
    expect(daemon.patches).toEqual([{ relay: { enabled: false } }]);
    expect(screen.queryByText("Turn off relay")).toBeNull();
  });

  it("says what turning it off does, in Traditional Chinese too", async () => {
    await i18n.changeLanguage("zh-TW");
    renderPairingScreen();

    expect(await screen.findByText("停用中繼")).toBeTruthy();
    expect(screen.getByText("停用後，透過中繼配對的裝置就無法連線。")).toBeTruthy();
    await waitFor(() => expect(daemon.patches).toEqual([]));
  });
});
