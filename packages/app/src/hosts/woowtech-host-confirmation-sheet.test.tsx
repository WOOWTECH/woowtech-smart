/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionOffer } from "@getpaseo/protocol/connection-offer";
import { defaultHostAppearance } from "@/hosts/appearance";
import { i18n } from "@/i18n/i18next";
import { HostConfirmations } from "@/runtime/woowtech-host-confirmations";
import { formatDaemonKeyFingerprint } from "@/runtime/woowtech-offer-link";
import type { HostConnection, HostProfile } from "@/types/host-connection";

// The sheet's own frame is a portal on the web and a bottom sheet on phones; this one shows its
// title and its close button so the test can read and press them.
vi.mock("@/components/adaptive-modal-sheet", async () => {
  const ReactModule = await import("react");
  return {
    AdaptiveModalSheet: (props: {
      visible: boolean;
      header: { title: string };
      onClose: () => void;
      testID?: string;
      children: React.ReactNode;
    }) =>
      props.visible
        ? ReactModule.createElement(
            "div",
            { "data-testid": props.testID },
            ReactModule.createElement("h2", { "data-testid": "sheet-title" }, props.header.title),
            ReactModule.createElement("button", {
              type: "button",
              "data-testid": "sheet-close",
              onClick: props.onClose,
            }),
            props.children,
          )
        : null,
  };
});

const KEY = Buffer.alloc(32, 3).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 4).toString("base64");
const PRODUCT_RELAY = "relay.woowtech.io:443";

function offer(overrides: Partial<ConnectionOffer> = {}): ConnectionOffer {
  return {
    v: 2,
    serverId: "srv_sheet01",
    daemonPublicKeyB64: KEY,
    relay: { endpoint: PRODUCT_RELAY, useTls: true },
    ...overrides,
  };
}

function savedHost(label: string, connections: HostConnection[]): HostProfile {
  return {
    serverId: "srv_sheet01",
    label,
    appearance: defaultHostAppearance(),
    lifecycle: {},
    connections,
    preferredConnectionId: connections[0]?.id ?? null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

const SAVED_RELAY: HostConnection = {
  id: `relay:wss:${PRODUCT_RELAY}`,
  type: "relay",
  relayEndpoint: PRODUCT_RELAY,
  useTls: true,
  daemonPublicKeyB64: KEY,
};
const LAN: HostConnection = { id: "direct:lan:6770", type: "directTcp", endpoint: "lan:6770" };

let sheet: typeof import("./woowtech-host-confirmation-sheet");

beforeAll(async () => {
  vi.stubGlobal("React", React);
  sheet = await import("./woowtech-host-confirmation-sheet");
}, 120_000);

beforeEach(() => {
  vi.stubGlobal("React", React);
  // jsdom reports focus only once an element has it; a browser window in front reports it.
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

/** Puts `question` to the user and shows the sheet for it. */
function ask(confirmations: HostConfirmations, question: Promise<boolean>): Promise<boolean> {
  render(<sheet.WoowtechHostConfirmationSheet confirmations={confirmations} />);
  return question;
}

function wait(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** A real click: the pointer comes over Connect, presses and lets go. */
function clickConnect(): void {
  const connect = screen.getByTestId("host-confirmation-connect");
  fireEvent.pointerMove(connect);
  fireEvent.mouseDown(connect);
  fireEvent.mouseUp(connect);
  fireEvent.click(connect);
}

function text(testID: string): string | null {
  return screen.queryByTestId(testID)?.textContent ?? null;
}

describe("the host confirmation sheet", () => {
  it("shows the host, its key fingerprint and the relay, and connects once armed", async () => {
    vi.useFakeTimers();
    const confirmations = new HostConfirmations();
    const answer = ask(confirmations, confirmations.confirmLink(offer(), []));

    expect(screen.getByTestId("host-confirmation")).toBeTruthy();
    expect(text("sheet-title")).toBe("Connect to this host?");
    expect(text("host-confirmation-server-id")).toBe("srv_sheet01");
    expect(text("host-confirmation-fingerprint")).toBe(formatDaemonKeyFingerprint(KEY));
    expect(text("host-confirmation-relay")).toBe(PRODUCT_RELAY);
    expect(text("host-confirmation-description")).toContain("run code in this app");
    expect(screen.getByText(/Pair device on your computer/)).toBeTruthy();
    expect(screen.queryByTestId("host-confirmation-other-relay")).toBeNull();

    const connect = screen.getByTestId("host-confirmation-connect");
    expect(connect.getAttribute("aria-disabled")).toBe("true");
    wait(500);
    fireEvent.click(connect);
    expect(confirmations.getPending()).not.toBeNull();

    wait(500);
    expect(connect.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(connect);
    expect(confirmations.getPending()).not.toBeNull();

    clickConnect();
    await expect(answer).resolves.toBe(true);
    expect(screen.queryByTestId("host-confirmation")).toBeNull();
  });

  it("puts the focus on Cancel, and Cancel says no", async () => {
    const confirmations = new HostConfirmations();
    const answer = ask(confirmations, confirmations.confirmLink(offer(), []));

    const cancel = screen.getByTestId("host-confirmation-cancel");
    expect(document.activeElement).toBe(cancel);
    fireEvent.click(cancel);
    await expect(answer).resolves.toBe(false);
  });

  it("says no when the sheet is closed", async () => {
    const confirmations = new HostConfirmations();
    const answer = ask(confirmations, confirmations.confirmLink(offer(), []));

    fireEvent.click(screen.getByTestId("sheet-close"));
    await expect(answer).resolves.toBe(false);
  });

  it("warns about a relay that is not woowtech smart's", () => {
    const confirmations = new HostConfirmations();
    void ask(
      confirmations,
      confirmations.confirmLink(
        offer({ relay: { endpoint: "relay.example.test:443", useTls: true } }),
        [],
      ),
    );

    expect(text("host-confirmation-other-relay")).toContain(
      "uses a relay other than woowtech smart's (relay.woowtech.io:443)",
    );
  });

  it("warns that a browser keeps the host and can reach this computer's daemons", () => {
    const confirmations = new HostConfirmations();
    void ask(confirmations, confirmations.confirmLink(offer(), []));

    expect(text("host-confirmation-web-warning")).toContain("kept in this browser");
  });

  it("only lets a link that changes the saved key be closed", async () => {
    const confirmations = new HostConfirmations();
    const answer = ask(
      confirmations,
      confirmations.confirmLink(offer({ daemonPublicKeyB64: OTHER_KEY }), [
        savedHost("Studio Mac", [SAVED_RELAY]),
      ]),
    );

    expect(text("sheet-title")).toBe("This host's key has changed");
    expect(text("host-confirmation-key-changed")).toContain('saved for "Studio Mac"');
    expect(screen.queryByTestId("host-confirmation-connect")).toBeNull();
    expect(screen.queryByTestId("host-confirmation-cancel")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("host-confirmation-close"));
    fireEvent.click(screen.getByTestId("host-confirmation-close"));
    await expect(answer).resolves.toBe(false);
  });

  it("shows the saved name and the saved relay when a link changes the connection", () => {
    const confirmations = new HostConfirmations();
    void ask(
      confirmations,
      confirmations.confirmLink(
        offer({ relay: { endpoint: "relay.example.test:443", useTls: true } }),
        [savedHost("Studio\u202E Mac\u202C", [SAVED_RELAY])],
      ),
    );

    expect(text("host-confirmation-description")).toContain("This link changes how you connect");
    expect(text("host-confirmation-saved-label")).toBe("Studio Mac");
    expect(text("host-confirmation-saved-relay")).toBe(PRODUCT_RELAY);
    expect(text("host-confirmation-relay")).toBe("relay.example.test:443");
  });

  it("shows the address and no fingerprint for a direct connection to a saved host", () => {
    const confirmations = new HostConfirmations();
    void ask(
      confirmations,
      confirmations.confirmProbedConnection({
        serverId: "srv_sheet01",
        connection: LAN,
        savedHosts: [savedHost("Studio Mac", [SAVED_RELAY])],
        browser: true,
        pageHostname: null,
      }),
    );

    expect(text("sheet-title")).toBe('Add this connection to "Studio Mac"?');
    expect(text("host-confirmation-saved-label")).toBe("Studio Mac");
    expect(text("host-confirmation-endpoint")).toBe("lan:6770");
    expect(screen.queryByTestId("host-confirmation-fingerprint")).toBeNull();
    expect(screen.queryByTestId("host-confirmation-relay")).toBeNull();
  });

  it("shows the host id and the address and no fingerprint for a new direct host", () => {
    const confirmations = new HostConfirmations();
    void ask(
      confirmations,
      confirmations.confirmProbedConnection({
        serverId: "srv_lan02",
        connection: LAN,
        savedHosts: [],
        browser: true,
        pageHostname: null,
      }),
    );

    expect(text("sheet-title")).toBe("Connect to this host?");
    expect(text("host-confirmation-server-id")).toBe("srv_lan02");
    expect(text("host-confirmation-endpoint")).toBe("lan:6770");
    expect(screen.queryByTestId("host-confirmation-fingerprint")).toBeNull();
  });

  it("reads in Traditional Chinese", async () => {
    await i18n.changeLanguage("zh-TW");
    const confirmations = new HostConfirmations();
    void ask(confirmations, confirmations.confirmLink(offer(), []));

    expect(text("sheet-title")).toBe("要連線到這台主機嗎？");
    expect(text("host-confirmation-connect")).toBe("連線");
    expect(text("host-confirmation-cancel")).toBe("取消");
  });
});
