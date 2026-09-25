/**
 * @vitest-environment jsdom
 */
// The QR scanner is the /pair-scan route (src/app/pair-scan.tsx). Its test lives out
// here because Expo Router treats every file in src/app as a route.
import { act, cleanup, render, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const scanner = vi.hoisted(() => ({
  onBarcodeScanned: null as ((result: { type: string; data: string }) => unknown) | null,
  routes: [] as string[],
  probes: [] as unknown[],
  imports: [] as Array<{ link: string; label: string | undefined }>,
}));

// The camera exists on phones only.
vi.mock("@/constants/platform", () => ({ isWeb: false, isNative: true }));

vi.mock("expo-camera", () => ({
  CameraView: (props: {
    onBarcodeScanned?: (result: { type: string; data: string }) => unknown;
  }) => {
    scanner.onBarcodeScanned = props.onBarcodeScanned ?? null;
    return null;
  },
  useCameraPermissions: () => [{ granted: true }, async () => ({ granted: true })],
}));

vi.mock("expo-router", () => ({
  useRouter: () => ({
    replace: (route: string) => scanner.routes.push(route),
    back: () => undefined,
  }),
  useLocalSearchParams: () => ({ source: "onboarding" }),
}));

vi.mock("@/components/headers/back-header", () => ({ BackHeader: () => null }));

vi.mock("@/runtime/host-runtime", () => ({
  useHostMutations: () => ({
    upsertConnectionFromOfferUrl: async (link: string, label?: string) => {
      scanner.imports.push({ link, label });
      return { serverId: "srv_pairing_test" };
    },
  }),
}));

vi.mock("@/utils/test-daemon-connection", () => ({
  connectToDaemon: async (connection: unknown, options: unknown) => {
    scanner.probes.push({ connection, options });
    return { client: { close: async () => undefined }, hostname: "mbp" };
  },
}));

const OFFER = {
  v: 2,
  serverId: "srv_pairing_test",
  daemonPublicKeyB64: "cGFpcmluZy10ZXN0LWtleQ==",
  relay: { endpoint: "relay.woowtech.io:443", useTls: true },
};
const APP_LINK = `woowtech-smart:///#offer=${Buffer.from(JSON.stringify(OFFER)).toString("base64url")}`;

let screen: typeof import("@/app/pair-scan");
const linksGivenToUrl: string[] = [];

beforeAll(async () => {
  vi.stubGlobal("React", React);
  screen = await import("@/app/pair-scan");
}, 120_000);

beforeEach(() => {
  vi.stubGlobal("React", React);
  // React Native's URL class does not reliably read the fragment of a custom-scheme
  // link, so the scanner has to find the offer without it.
  vi.stubGlobal(
    "URL",
    class extends URL {
      constructor(input: string | URL, base?: string | URL) {
        super(input, base);
        if (String(input).includes("#offer=")) linksGivenToUrl.push(String(input));
      }
    },
  );
  scanner.onBarcodeScanned = null;
  scanner.routes = [];
  scanner.probes = [];
  scanner.imports = [];
  linksGivenToUrl.length = 0;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function scan(data: string): Promise<void> {
  render(<screen.default />);
  await waitFor(() => expect(scanner.onBarcodeScanned).not.toBeNull());
  await act(async () => {
    await scanner.onBarcodeScanned?.({ type: "qr", data });
  });
}

// woowtech smart's QR codes carry links that open the app: woowtech-smart:///#offer=….
describe("scanning a pairing QR code in the app", () => {
  it("pairs the host from a link in the app's own scheme", async () => {
    await scan(APP_LINK);

    await waitFor(() => expect(scanner.routes).toEqual(["/h/srv_pairing_test"]));
    expect(scanner.probes).toEqual([
      {
        connection: {
          id: "probe",
          type: "relay",
          relayEndpoint: "relay.woowtech.io:443",
          useTls: true,
          daemonPublicKeyB64: OFFER.daemonPublicKeyB64,
        },
        options: { serverId: "srv_pairing_test" },
      },
    ]);
    expect(scanner.imports).toEqual([{ link: APP_LINK, label: "mbp" }]);
    expect(linksGivenToUrl).toEqual([]);
  });

  it("ignores a QR code without an offer", async () => {
    await scan("woowtech-smart:///");

    expect(scanner.probes).toEqual([]);
    expect(scanner.routes).toEqual([]);
  });
});
