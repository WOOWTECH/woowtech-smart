/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BRAND_PAIRING } from "@getpaseo/protocol/brand-pairing";
import { PairingOfferError } from "@/runtime/woowtech-offer-link";

// Pairing confirmation, probing and persistence are owned by HostRuntimeStore. This UI
// boundary checks the exact link handed to that flow and its success/cancel/error outcomes.
const daemon = vi.hoisted(() => ({
  submissions: [] as Array<{ link: string; password: string | undefined }>,
  outcome: "connected" as "connected" | "cancelled" | Error,
  saved: [] as unknown[],
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
    beginLinkPairing: () => ({
      submit: async (link: string, password?: string) => {
        daemon.submissions.push({ link, password });
        if (daemon.outcome instanceof Error) throw daemon.outcome;
        if (daemon.outcome === "cancelled") return { status: "cancelled" };
        return {
          status: "connected",
          profile: { serverId: "srv_pairing_test" },
          serverId: "srv_pairing_test",
          hostname: "mbp",
        };
      },
    }),
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

let modal: typeof import("@/hosts/add-host/internal/pair-link-modal");
const linksGivenToUrl: string[] = [];
const closeModal = () => undefined;
const recordSaved = (result: unknown) => {
  daemon.saved.push(result);
};

beforeAll(async () => {
  vi.stubGlobal("React", React);
  modal = await import("@/hosts/add-host/internal/pair-link-modal");
}, 120_000);

beforeEach(() => {
  vi.stubGlobal("React", React);
  // React Native's URL class does not reliably read the fragment of a custom-scheme
  // link, so the modal must hand the link to the runtime without rewriting it.
  vi.stubGlobal(
    "URL",
    class extends URL {
      constructor(input: string | URL, base?: string | URL) {
        super(input, base);
        if (String(input).includes("#offer=")) linksGivenToUrl.push(String(input));
      }
    },
  );
  daemon.submissions = [];
  daemon.outcome = "connected";
  daemon.saved = [];
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

// woowtech smart's daemon hands out links that open the web app; older daemons hand out links in
// the app's own scheme. Both must reach the runtime's confirmation and pairing flow intact.
describe("pasting a pairing link", () => {
  it("shows the daemon's link as the example", () => {
    render(<modal.PairLinkModal visible onClose={closeModal} />);

    expect(screen.getByTestId("pair-link-input").getAttribute("placeholder")).toBe(
      BRAND_PAIRING.linkExample,
    );
  });

  it("forwards a web app link and reports the runtime's connected host", async () => {
    paste(WEB_LINK);

    await waitFor(() => expect(daemon.saved).toHaveLength(1));
    expect(daemon.saved).toEqual([
      {
        profile: { serverId: "srv_pairing_test" },
        serverId: "srv_pairing_test",
        hostname: "mbp",
        isNewHost: true,
      },
    ]);
    expect(daemon.submissions).toEqual([{ link: WEB_LINK, password: undefined }]);
    expect(linksGivenToUrl).toEqual([]);
  });

  it("forwards a link in the app's own scheme with only surrounding whitespace removed", async () => {
    paste(`  ${APP_LINK}  `);

    await waitFor(() => expect(daemon.saved).toHaveLength(1));
    expect(daemon.submissions).toEqual([{ link: APP_LINK, password: undefined }]);
    expect(linksGivenToUrl).toEqual([]);
  });

  it("reports no saved host or error when the runtime cancels pairing", async () => {
    daemon.outcome = "cancelled";
    paste(WEB_LINK);

    await waitFor(() =>
      expect(daemon.submissions).toEqual([{ link: WEB_LINK, password: undefined }]),
    );
    await act(async () => {});
    expect(daemon.saved).toEqual([]);
    expect(screen.queryByText(/errors|Error|Invalid|Unable/)).toBeNull();
  });

  it("shows why a link cannot be used", async () => {
    daemon.outcome = new PairingOfferError("Invalid pairing offer: the relay is not host:port");
    paste(WEB_LINK);

    expect(
      await screen.findByText("Invalid pairing offer: the relay is not host:port"),
    ).toBeTruthy();
    expect(daemon.saved).toEqual([]);
  });
});
