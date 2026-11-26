/**
 * @vitest-environment jsdom
 */
// The scanner now belongs to the add-host flow. The caller owns success navigation.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen as renderedScreen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { Linking } from "react-native";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PairingOfferError } from "@/runtime/woowtech-offer-link";

const scanner = vi.hoisted(() => ({
  onBarcodeScanned: null as ((result: { type: string; data: string }) => unknown) | null,
  connected: [] as string[],
  imports: [] as Array<{ link: string; target: string }>,
  outcome: "connected" as "connected" | "cancelled" | Error,
  permission: { granted: true, canAskAgain: true },
  permissionRequests: 0,
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

vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({
    importConnectionLink: async (link: string, target: string) => {
      scanner.imports.push({ link, target });
      if (scanner.outcome instanceof Error) throw scanner.outcome;
      return scanner.outcome === "cancelled"
        ? { status: "cancelled" }
        : { status: "connected", serverId: "srv_pairing_test" };
    },
  }),
  useHosts: () => [],
  useHostMutations: () => ({
    beginLinkPairing: () => ({ submit: async () => ({ status: "cancelled" }) }),
  }),
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
let screen: typeof import("@/hosts/add-host/internal/scan");
const onConnected = (serverId: string) => {
  scanner.connected.push(serverId);
};
const onClose = () => {};
const linksGivenToUrl: string[] = [];

beforeAll(async () => {
  vi.stubGlobal("React", React);
  screen = await import("@/hosts/add-host/internal/scan");
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
  scanner.connected = [];
  scanner.imports = [];
  scanner.permission = { granted: true, canAskAgain: true };
  scanner.permissionRequests = 0;
  scanner.outcome = "connected";
  linksGivenToUrl.length = 0;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The camera's next frame shows `data`. */
async function frame(data: string): Promise<void> {
  await act(async () => {
    await scanner.onBarcodeScanned?.({ type: "qr", data });
  });
}

async function scan(data: string): Promise<void> {
  render(<screen.PairScanContent onConnected={onConnected} onClose={onClose} />);
  await waitFor(() => expect(scanner.onBarcodeScanned).not.toBeNull());
  await frame(data);
}

// woowtech smart's QR codes carry links that open the web app; older daemons' QR codes carry
// links in the app's own scheme. The scanner passes both to the runtime's pairing flow.
describe("scanning a pairing QR code in the app", () => {
  it("forwards a web app link and reports the runtime's connected host", async () => {
    await scan(WEB_LINK);

    await waitFor(() => expect(scanner.connected).toEqual(["srv_pairing_test"]));
    expect(scanner.imports).toEqual([{ link: WEB_LINK, target: "hostRoot" }]);
    expect(linksGivenToUrl).toEqual([]);
  });

  it("forwards a link in the app's own scheme unchanged", async () => {
    await scan(APP_LINK);

    await waitFor(() => expect(scanner.connected).toEqual(["srv_pairing_test"]));
    expect(scanner.imports).toEqual([{ link: APP_LINK, target: "hostRoot" }]);
    expect(linksGivenToUrl).toEqual([]);
  });

  it("reports no connected host after cancellation and ignores repeated frames", async () => {
    scanner.outcome = "cancelled";
    await scan(WEB_LINK);
    await frame(WEB_LINK);
    await frame(WEB_LINK);

    expect(scanner.imports).toEqual([{ link: WEB_LINK, target: "hostRoot" }]);
    expect(scanner.connected).toEqual([]);
    expect(renderedScreen.queryByText(/Invalid pairing offer/)).toBeNull();
  });

  it("shows why a code cannot be used, connects to nothing, and does not ask again about it", async () => {
    scanner.outcome = new PairingOfferError("Invalid pairing offer: the relay is not host:port");
    await scan(WEB_LINK);
    await frame(WEB_LINK);
    await frame(WEB_LINK);

    expect(
      renderedScreen.getByText("Invalid pairing offer: the relay is not host:port"),
    ).toBeTruthy();
    expect(scanner.imports).toEqual([{ link: WEB_LINK, target: "hostRoot" }]);
    expect(scanner.connected).toEqual([]);
  });

  it("does not retry the same code on every frame after a failed connection", async () => {
    scanner.outcome = new Error("relay unreachable");
    await scan(WEB_LINK);
    await frame(WEB_LINK);
    await frame(WEB_LINK);

    expect(scanner.imports).toEqual([{ link: WEB_LINK, target: "hostRoot" }]);

    // A stopped attempt ignores every camera frame until the user explicitly scans again.
    await frame(APP_LINK);
    expect(scanner.imports).toEqual([{ link: WEB_LINK, target: "hostRoot" }]);
    scanner.outcome = "connected";
    fireEvent.click(renderedScreen.getByTestId("pair-scan-again"));
    await frame(APP_LINK);
    await waitFor(() => expect(scanner.connected).toEqual(["srv_pairing_test"]));
    expect(scanner.imports).toEqual([
      { link: WEB_LINK, target: "hostRoot" },
      { link: APP_LINK, target: "hostRoot" },
    ]);
  });

  it("ignores a QR code without an offer", async () => {
    await scan("woowtech-smart:///");

    expect(scanner.imports).toEqual([]);
    expect(scanner.connected).toEqual([]);
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

    const view = render(<screen.PairScanContent onConnected={onConnected} onClose={onClose} />);
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

    const view = render(<screen.PairScanContent onConnected={onConnected} onClose={onClose} />);
    await waitFor(() => expect(scanner.permissionRequests).toBeGreaterThan(0));
    const requestsBeforeTap = scanner.permissionRequests;
    fireEvent.click(view.getByText(GRANT_BUTTON));

    expect(scanner.permissionRequests).toBe(requestsBeforeTap + 1);
    expect(openSettings).not.toHaveBeenCalled();
  });
});
