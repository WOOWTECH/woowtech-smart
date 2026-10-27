/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BRAND_PAIRING } from "@getpaseo/protocol/brand-pairing";
import { PairingOfferError } from "@/runtime/woowtech-offer-link";

// What the modal hands to the daemon probe, to the host registry and to its caller.
const daemon = vi.hoisted(() => ({
  probes: [] as unknown[],
  imports: [] as Array<{ link: string; label: string | undefined }>,
  saved: [] as unknown[],
}));

// The user's answer to the host confirmation (runtime/woowtech-pairing-confirmation.ts), and the
// links it was asked about.
const confirmation = vi.hoisted(() => ({
  answer: true as boolean | Error,
  asked: [] as string[],
}));

vi.mock("@/runtime/woowtech-pairing-confirmation", () => ({
  confirmPairingLink: async (link: string) => {
    confirmation.asked.push(link);
    if (confirmation.answer instanceof Error) throw confirmation.answer;
    return confirmation.answer;
  },
}));

vi.mock("@/components/adaptive-modal-sheet", async () => {
  const ReactModule = await import("react");
  return {
    AdaptiveModalSheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
      visible ? ReactModule.createElement("div", null, children) : null,
    AdaptiveTextInput: (props: {
      testID?: string;
      placeholder?: string;
      onChangeText?: (next: string) => void;
    }) =>
      ReactModule.createElement("input", {
        "data-testid": props.testID,
        placeholder: props.placeholder,
        onChange: (event: { target: { value: string } }) =>
          props.onChangeText?.(event.target.value),
      }),
  };
});

vi.mock("@/components/ui/button", async () => {
  const ReactModule = await import("react");
  return {
    Button: (props: { testID?: string; onPress?: () => void; children?: React.ReactNode }) =>
      ReactModule.createElement(
        "button",
        { type: "button", "data-testid": props.testID, onClick: props.onPress },
        props.children,
      ),
  };
});

vi.mock("@/constants/layout", () => ({ useIsCompactFormFactor: () => true }));

vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => [],
  useHostMutations: () => ({
    upsertConnectionFromOfferUrl: async (link: string, label?: string) => {
      daemon.imports.push({ link, label });
      return { serverId: "srv_pairing_test" };
    },
  }),
}));

vi.mock("@/utils/test-daemon-connection", () => ({
  connectToDaemon: async (connection: unknown, options: unknown) => {
    daemon.probes.push({ connection, options });
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

let modal: typeof import("./pair-link-modal");
const linksGivenToUrl: string[] = [];
const closeModal = () => undefined;
const recordSaved = (result: unknown) => {
  daemon.saved.push(result);
};

beforeAll(async () => {
  vi.stubGlobal("React", React);
  modal = await import("./pair-link-modal");
}, 120_000);

beforeEach(() => {
  vi.stubGlobal("React", React);
  // React Native's URL class does not reliably read the fragment of a custom-scheme
  // link, so the modal has to find the offer without it.
  vi.stubGlobal(
    "URL",
    class extends URL {
      constructor(input: string | URL, base?: string | URL) {
        super(input, base);
        if (String(input).includes("#offer=")) linksGivenToUrl.push(String(input));
      }
    },
  );
  daemon.probes = [];
  daemon.imports = [];
  daemon.saved = [];
  confirmation.answer = true;
  confirmation.asked = [];
  linksGivenToUrl.length = 0;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function paste(link: string): void {
  render(<modal.PairLinkModal visible onClose={closeModal} onSaved={recordSaved} />);
  fireEvent.change(screen.getByTestId("pair-link-input"), { target: { value: link } });
  fireEvent.click(screen.getByTestId("pair-link-submit"));
}

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

// woowtech smart's daemon hands out links that open the web app; older daemons hand out links in
// the app's own scheme. Pasted, both pair once the user confirms the host.
describe("pasting a pairing link", () => {
  it("shows the daemon's link as the example", () => {
    render(<modal.PairLinkModal visible onClose={closeModal} />);

    expect(screen.getByTestId("pair-link-input").getAttribute("placeholder")).toBe(
      BRAND_PAIRING.linkExample,
    );
  });

  it("pairs the host from a web app link once the user confirms it", async () => {
    paste(WEB_LINK);

    await waitFor(() => expect(daemon.saved).toHaveLength(1));
    expect(confirmation.asked).toEqual([WEB_LINK]);
    expect(daemon.saved).toEqual([
      {
        profile: { serverId: "srv_pairing_test" },
        serverId: "srv_pairing_test",
        hostname: "mbp",
        isNewHost: true,
      },
    ]);
    expect(daemon.probes).toEqual([PROBE]);
    expect(daemon.imports).toEqual([{ link: WEB_LINK, label: "mbp" }]);
    expect(linksGivenToUrl).toEqual([]);
  });

  it("pairs the host from a link in the app's own scheme, asking with the text as pasted", async () => {
    paste(`  ${APP_LINK}  `);

    await waitFor(() => expect(daemon.saved).toHaveLength(1));
    expect(confirmation.asked).toEqual([APP_LINK]);
    expect(daemon.probes).toEqual([PROBE]);
    expect(daemon.imports).toEqual([{ link: APP_LINK, label: "mbp" }]);
    expect(linksGivenToUrl).toEqual([]);
  });

  it("connects to nothing and shows no error when the user says no", async () => {
    confirmation.answer = false;
    paste(WEB_LINK);

    await waitFor(() => expect(confirmation.asked).toEqual([WEB_LINK]));
    await act(async () => {});
    expect(daemon.probes).toEqual([]);
    expect(daemon.imports).toEqual([]);
    expect(daemon.saved).toEqual([]);
    expect(screen.queryByText(/errors|Error|Invalid|Unable/)).toBeNull();
  });

  it("shows why a link cannot be used", async () => {
    confirmation.answer = new PairingOfferError(
      "Invalid pairing offer: the relay is not host:port",
    );
    paste(WEB_LINK);

    expect(
      await screen.findByText("Invalid pairing offer: the relay is not host:port"),
    ).toBeTruthy();
    expect(daemon.probes).toEqual([]);
    expect(daemon.imports).toEqual([]);
  });
});
