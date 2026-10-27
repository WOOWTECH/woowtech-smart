import { describe, expect, it } from "vitest";
import type { ConnectionOffer } from "@getpaseo/protocol/connection-offer";
import {
  displayText,
  formatDaemonKeyFingerprint,
  linkMentionsOffer,
  offerPayloadFromLink,
  PairingOfferError,
  readPairingOffer,
  validatePairingOffer,
} from "./woowtech-offer-link";

// A daemon key is a 32-byte nacl box public key, standard base64 with padding (relay/src/crypto.ts).
const KEY_BYTES = Uint8Array.from({ length: 32 }, (_, index) => (index * 37 + 11) % 256);
const KEY_B64 = Buffer.from(KEY_BYTES).toString("base64");
const KEY_B64URL = Buffer.from(KEY_BYTES).toString("base64url");

const OFFER: ConnectionOffer = {
  v: 2,
  serverId: "srv_AbCdEfGh1234",
  daemonPublicKeyB64: KEY_B64,
  relay: { endpoint: "relay.woowtech.io:443", useTls: true },
};
const PAYLOAD = Buffer.from(JSON.stringify(OFFER)).toString("base64url");

function offerWith(overrides: Partial<ConnectionOffer>): ConnectionOffer {
  return { ...OFFER, ...overrides };
}

function relayAt(endpoint: string): ConnectionOffer {
  return offerWith({ relay: { endpoint, useTls: true } });
}

describe("what counts as a pairing link", () => {
  it("is a link whose fragment, from its first #, starts with offer=", () => {
    for (const link of [
      `https://web.example.test/#offer=${PAYLOAD}`,
      `https://web.example.test/?a=1#offer=${PAYLOAD}`,
      `woowtech-smart:///#offer=${PAYLOAD}`,
      `#offer=${PAYLOAD}`,
      `  https://web.example.test/#offer=${PAYLOAD}\n`,
    ]) {
      expect(offerPayloadFromLink(link)).toBe(PAYLOAD);
    }
  });

  it("is not a link with offer= anywhere else in its fragment, without a #, or without a payload", () => {
    for (const link of [
      `https://web.example.test/#x#offer=${PAYLOAD}`,
      `https://web.example.test/#xoffer=${PAYLOAD}`,
      `https://web.example.test/?offer=${PAYLOAD}`,
      "https://web.example.test/",
      "https://web.example.test/#offer=",
      "https://web.example.test/#offer=   ",
      "",
    ]) {
      expect(offerPayloadFromLink(link)).toBeNull();
    }
  });

  it("mentions an offer whenever the fragment carries offer=, which is what the address bar drops", () => {
    expect(linkMentionsOffer(`https://web.example.test/#offer=${PAYLOAD}`)).toBe(true);
    expect(linkMentionsOffer(`https://web.example.test/#x#offer=${PAYLOAD}`)).toBe(true);
    expect(linkMentionsOffer("https://web.example.test/#offer=")).toBe(true);
    expect(linkMentionsOffer(`https://web.example.test/?offer=${PAYLOAD}`)).toBe(false);
    expect(linkMentionsOffer("https://web.example.test/#settings")).toBe(false);
    expect(linkMentionsOffer("woowtech-smart:///")).toBe(false);
  });
});

describe("reading a pairing link", () => {
  it("returns the offer of a valid link", () => {
    expect(readPairingOffer(`https://web.example.test/#offer=${PAYLOAD}`)).toEqual(OFFER);
    expect(readPairingOffer(`woowtech-smart:///#offer=${PAYLOAD}`)).toEqual(OFFER);
  });

  it("throws a PairingOfferError for every link it cannot use", () => {
    const notJson = Buffer.from("not json").toString("base64url");
    const wrongShape = Buffer.from(JSON.stringify({ v: 1, serverId: "srv_x" })).toString(
      "base64url",
    );
    for (const link of [
      `https://web.example.test/#x#offer=${PAYLOAD}`,
      "https://web.example.test/#offer=",
      `https://web.example.test/#offer=${PAYLOAD}&y`,
      `https://web.example.test/#offer=${notJson}`,
      `https://web.example.test/#offer=${wrongShape}`,
      `https://web.example.test/#offer=${Buffer.from(JSON.stringify(offerWith({ serverId: "srv:1" }))).toString("base64url")}`,
    ]) {
      expect(() => readPairingOffer(link)).toThrow(PairingOfferError);
    }
  });
});

describe("validating an offer beyond its schema", () => {
  it("accepts the server ids daemons hand out", () => {
    for (const serverId of ["srv_AbCdEfGh1234", "srv_label_test", "srv-A_1", "x".repeat(64)]) {
      expect(() => validatePairingOffer(offerWith({ serverId }))).not.toThrow();
    }
  });

  it("refuses server ids that could not be printed plainly on the sheet", () => {
    for (const serverId of [
      "srv_line\nbreak",
      "srv_\u202Eevil",
      "x".repeat(65),
      "srv:1",
      "srv 1",
      "",
    ]) {
      expect(() => validatePairingOffer(offerWith({ serverId }))).toThrow(PairingOfferError);
    }
  });

  it("accepts a 32-byte key in base64 or base64url, around white space", () => {
    for (const key of [KEY_B64, KEY_B64URL, ` ${KEY_B64} `]) {
      expect(() => validatePairingOffer(offerWith({ daemonPublicKeyB64: key }))).not.toThrow();
    }
  });

  it("refuses keys that are not 32 bytes of base64", () => {
    for (const key of [
      Buffer.alloc(31, 7).toString("base64"),
      Buffer.alloc(33, 7).toString("base64"),
      `${KEY_B64.slice(0, 20)} ${KEY_B64.slice(20)}`,
      `${KEY_B64.slice(0, -1)}!`,
      "synthetic-key",
    ]) {
      expect(() => validatePairingOffer(offerWith({ daemonPublicKeyB64: key }))).toThrow(
        PairingOfferError,
      );
    }
  });

  it("accepts relay endpoints with a plain host name, an IP address or a bracketed IPv6 address", () => {
    for (const endpoint of [
      "relay.woowtech.io:443",
      "relay.example.test:8443",
      "192.168.1.20:6770",
      "[::1]:6770",
      "[fe80::1]:443",
    ]) {
      expect(() => validatePairingOffer(relayAt(endpoint))).not.toThrow();
    }
  });

  it("refuses relay endpoints with spaces, other scripts, no port, or a port out of range", () => {
    for (const endpoint of [
      "relay.woowtech .io:443",
      "relay.woowtech.io :443",
      "中繼.example.test:443",
      "relay.woowtech.io",
      "relay.woowtech.io:0",
      "relay.woowtech.io:70000",
      "relay_woowtech.io:443",
      "[relay.example]:443",
    ]) {
      expect(() => validatePairingOffer(relayAt(endpoint))).toThrow(PairingOfferError);
    }
  });
});

describe("the key fingerprint", () => {
  it("shows the first and last 8 characters of a full key, in groups of four", () => {
    const fingerprint = formatDaemonKeyFingerprint(KEY_B64);
    const alphanumeric = KEY_B64.replace(/[^A-Za-z0-9]/g, "");
    expect(KEY_B64).toHaveLength(44);
    expect(fingerprint).toMatch(/^[A-Za-z0-9]{4} [A-Za-z0-9]{4} … [A-Za-z0-9]{4} [A-Za-z0-9]{4}$/);
    expect(fingerprint).toBe(
      `${alphanumeric.slice(0, 4)} ${alphanumeric.slice(4, 8)} … ${alphanumeric.slice(-8, -4)} ${alphanumeric.slice(-4)}`,
    );
  });

  it("groups a short key whole", () => {
    expect(formatDaemonKeyFingerprint("ABCDEFGHIJ")).toBe("ABCD EFGH IJ");
    expect(formatDaemonKeyFingerprint("AB+C/D=EFGH")).toBe("ABCD EFGH");
  });
});

describe("text shown on the confirmation sheet", () => {
  it("drops bidi, zero-width and control characters", () => {
    expect(displayText("Studio\u202E Mac\u202C")).toBe("Studio Mac");
    expect(displayText("\u202Aa\u202Bb\u202Cc\u202Dd")).toBe("abcd");
    expect(displayText("\u2066a\u2067b\u2068c\u2069d")).toBe("abcd");
    expect(displayText("a\u200Eb\u200Fc\u200Bd\uFEFFe\u061Cf\u2060g")).toBe("abcdefg");
    expect(displayText("a\u0000b\u0007c\u001Fd\u007Fe\u0080f\u009Fg")).toBe("abcdefg");
  });

  it("keeps one line, with runs of white space as one space", () => {
    expect(displayText("Studio\nMac")).toBe("Studio Mac");
    expect(displayText("  Studio \r\n\t Mac\u2028Pro\u2029 ")).toBe("Studio Mac Pro");
  });

  it("cuts long text to the limit, ending in an ellipsis", () => {
    expect(displayText("x".repeat(80))).toBe("x".repeat(80));
    expect(displayText("x".repeat(81))).toBe(`${"x".repeat(79)}…`);
    expect(displayText("abcdef", 4)).toBe("abc…");
    expect(displayText("主機名稱很長", 4)).toBe("主機名…");
  });
});
