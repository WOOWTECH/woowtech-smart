/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import { formatDaemonKeyFingerprint } from "@/runtime/woowtech-offer-link";

const KEY = Buffer.alloc(32, 21).toString("base64");

function linkWith(offer: unknown): string {
  return `https://web.example.test/#offer=${Buffer.from(JSON.stringify(offer)).toString("base64url")}`;
}

const VALID_LINK = linkWith({
  v: 2,
  serverId: "srv_desktop01",
  daemonPublicKeyB64: KEY,
  relay: { endpoint: "relay.woowtech.io:443", useTls: true },
});

let fingerprint: typeof import("./woowtech-pairing-fingerprint");

beforeAll(async () => {
  vi.stubGlobal("React", React);
  fingerprint = await import("./woowtech-pairing-fingerprint");
}, 120_000);

beforeEach(() => {
  vi.stubGlobal("React", React);
});

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

// The phone's confirmation sheet shows the daemon's key fingerprint; the desktop's "Pair device"
// screen shows the same value to compare it with.
describe("the key fingerprint on the desktop pairing screen", () => {
  it("shows the pairing link's key fingerprint", () => {
    render(<fingerprint.WoowtechPairingFingerprint url={VALID_LINK} />);

    expect(screen.getByTestId("pair-device-fingerprint").textContent).toBe(
      `Key fingerprint${formatDaemonKeyFingerprint(KEY)}`,
    );
  });

  it("labels it in Traditional Chinese", async () => {
    await i18n.changeLanguage("zh-TW");
    render(<fingerprint.WoowtechPairingFingerprint url={VALID_LINK} />);

    expect(screen.getByTestId("pair-device-fingerprint").textContent).toBe(
      `金鑰指紋${formatDaemonKeyFingerprint(KEY)}`,
    );
  });

  it("shows nothing for a link it cannot read", () => {
    for (const url of [
      "",
      "https://web.example.test/",
      linkWith({
        v: 2,
        serverId: "srv_desktop01",
        daemonPublicKeyB64: "short",
        relay: { endpoint: "relay.woowtech.io:443" },
      }),
    ]) {
      const view = render(<fingerprint.WoowtechPairingFingerprint url={url} />);
      expect(view.container.innerHTML).toBe("");
      view.unmount();
    }
  });
});
