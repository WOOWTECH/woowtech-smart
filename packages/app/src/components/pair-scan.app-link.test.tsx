/**
 * @vitest-environment jsdom
 */
// The QR scanner is the /pair-scan route (src/app/pair-scan.tsx). Its test lives out
// here because Expo Router treats every file in src/app as a route.
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import React from "react";
import { Linking } from "react-native";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const scanner = vi.hoisted(() => ({
  onBarcodeScanned: null as ((result: { type: string; data: string }) => unknown) | null,
  routes: [] as string[],
  probes: [] as unknown[],
  probeFailures: 0,
  imports: [] as Array<{ link: string; label: string | undefined }>,
  permission: { granted: true, canAskAgain: true },
  permissionRequests: 0,
}));

// The user's answer to the host confirmation (runtime/woowtech-pairing-confirmation.ts), and the
// codes it was asked about.
const confirmation = vi.hoisted(() => ({
  answer: true,
  asked: [] as string[],
}));

vi.mock("@/runtime/woowtech-pairing-confirmation", () => ({
  confirmPairingLink: async (link: string) => {
    confirmation.asked.push(link);
    return confirmation.answer;
  },
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
  useCameraPermissions: () => [
    scanner.permission,
    async () => {
      scanner.permissionRequests += 1;
      return scanner.permission;
    },
  ],
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
    if (scanner.probeFailures > 0) {
      scanner.probeFailures -= 1;
      throw new Error("relay unreachable");
    }
    return { client: { close: async () => undefined }, hostname: "mbp" };
  },
}));

const OFFER = {
  v: 2,
  serverId: "srv_pairing_test",
  daemonPublicKeyB64: "cGFpcmluZy10ZXN0LWtleQ==",
  relay: { endpoint: "relay.woowtech.io:443", useTls: true },
};
const PAYLOAD = Buffer.from(JSON.stringify(OFFER)).toString("base64url");
const APP_LINK = `woowtech-smart:///#offer=${PAYLOAD}`;
const WEB_LINK = `https://smart.woowtech.io/#offer=${PAYLOAD}`;
const PROBE = {
  connection: {
    id: "probe",
    type: "relay",
    relayEndpoint: "relay.woowtech.io:443",
    useTls: true,
    daemonPublicKeyB64: OFFER.daemonPublicKeyB64,
  },
  options: { serverId: "srv_pairing_test" },
};

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
  scanner.permission = { granted: true, canAskAgain: true };
  scanner.permissionRequests = 0;
  scanner.probeFailures = 0;
  confirmation.answer = true;
  confirmation.asked = [];
  linksGivenToUrl.length = 0;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The camera's next frame shows `data`. */
async function frame(data: string): Promise<void> {
  await act(async () => {
    await scanner.onBarcodeScanned?.({ type: "qr", data });
  });
}

async function scan(data: string): Promise<void> {
  render(<screen.default />);
  await waitFor(() => expect(scanner.onBarcodeScanned).not.toBeNull());
  await frame(data);
}

// woowtech smart's QR codes carry links that open the web app; older daemons' QR codes carry
// links in the app's own scheme. The scanner pairs both once the user confirms the host.
describe("scanning a pairing QR code in the app", () => {
  it("pairs the host from a web app link once the user confirms it", async () => {
    await scan(WEB_LINK);

    await waitFor(() => expect(scanner.routes).toEqual(["/h/srv_pairing_test"]));
    expect(confirmation.asked).toEqual([WEB_LINK]);
    expect(scanner.probes).toEqual([PROBE]);
    expect(scanner.imports).toEqual([{ link: WEB_LINK, label: "mbp" }]);
    expect(linksGivenToUrl).toEqual([]);
  });

  it("pairs the host from a link in the app's own scheme", async () => {
    await scan(APP_LINK);

    await waitFor(() => expect(scanner.routes).toEqual(["/h/srv_pairing_test"]));
    expect(confirmation.asked).toEqual([APP_LINK]);
    expect(scanner.probes).toEqual([PROBE]);
    expect(scanner.imports).toEqual([{ link: APP_LINK, label: "mbp" }]);
    expect(linksGivenToUrl).toEqual([]);
  });

  it("connects to nothing when the user says no, and does not ask again about the same code", async () => {
    confirmation.answer = false;
    await scan(WEB_LINK);
    await frame(WEB_LINK);
    await frame(WEB_LINK);

    expect(confirmation.asked).toEqual([WEB_LINK]);
    expect(scanner.probes).toEqual([]);
    expect(scanner.imports).toEqual([]);
    expect(scanner.routes).toEqual([]);
  });

  it("does not retry the same code on every frame after a failed connection", async () => {
    scanner.probeFailures = 1;
    await scan(WEB_LINK);
    await frame(WEB_LINK);
    await frame(WEB_LINK);

    expect(confirmation.asked).toEqual([WEB_LINK]);
    expect(scanner.probes).toEqual([PROBE]);
    expect(scanner.imports).toEqual([]);

    // Another code is a new attempt.
    await frame(APP_LINK);
    await waitFor(() => expect(scanner.routes).toEqual(["/h/srv_pairing_test"]));
    expect(confirmation.asked).toEqual([WEB_LINK, APP_LINK]);
  });

  it("ignores a QR code without an offer", async () => {
    await scan("woowtech-smart:///");

    expect(scanner.probes).toEqual([]);
    expect(scanner.routes).toEqual([]);
  });
});

// A denied camera leaves the scanner with a page and one button. After the system stops asking
// (the first denial on iOS, the second on Android) the button has to lead somewhere.
describe("the camera permission page", () => {
  const GRANT_BUTTON = /grantPermission|Grant permission|授予權限/;

  it("opens the app's settings from the button once the system will not ask again", async () => {
    const openSettings = vi.fn(async () => undefined);
    // react-native-web has no openSettings; the phone's Linking does.
    Object.assign(Linking, { openSettings });
    scanner.permission = { granted: false, canAskAgain: false };

    const view = render(<screen.default />);
    await waitFor(() => expect(scanner.permissionRequests).toBeGreaterThan(0));
    const requestsBeforeTap = scanner.permissionRequests;
    fireEvent.click(view.getByText(GRANT_BUTTON));

    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(scanner.permissionRequests).toBe(requestsBeforeTap);
  });

  it("asks again from the button while the system still will", async () => {
    const openSettings = vi.fn(async () => undefined);
    Object.assign(Linking, { openSettings });
    scanner.permission = { granted: false, canAskAgain: true };

    const view = render(<screen.default />);
    await waitFor(() => expect(scanner.permissionRequests).toBeGreaterThan(0));
    const requestsBeforeTap = scanner.permissionRequests;
    fireEvent.click(view.getByText(GRANT_BUTTON));

    expect(scanner.permissionRequests).toBe(requestsBeforeTap + 1);
    expect(openSettings).not.toHaveBeenCalled();
  });
});
