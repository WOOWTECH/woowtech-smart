import { expect, test } from "vitest";
import { BRAND } from "@getpaseo/protocol/brand-values";
import { BRAND_WEB_APP } from "@getpaseo/protocol/brand-web-app";
import type { ConnectionOffer } from "@getpaseo/protocol/connection-offer";
import { parseHostTarget } from "@getpaseo/protocol/host-target";
import { describeDaemonTarget } from "./daemon-target.js";

// A pairing link works like a password. CLI messages that name a --host target hide
// its offer, also in the app links of older QR codes (woowtech-smart:///#offer=…).
const pairingLinkBases = [`${BRAND.scheme}:///`, `${BRAND_WEB_APP.origin}/`];

test.each(pairingLinkBases)(
  "%s pairing links retain their offer while descriptions hide pairing material",
  (base) => {
    const offer = {
      v: 2,
      serverId: "srv_app_link",
      daemonPublicKeyB64: Buffer.alloc(32, 7).toString("base64"),
      relay: { endpoint: "relay.example.test:443", useTls: true },
      minimumSecurityMode: "protected",
    } satisfies ConnectionOffer;
    const encoded = Buffer.from(JSON.stringify(offer)).toString("base64url");
    const host = `${base}#offer=${encoded}`;

    expect(parseHostTarget(host)).toMatchObject({ kind: "socket", offer });
    expect(describeDaemonTarget({ kind: "endpoint", host })).toBe(
      "relay://relay.example.test:443/srv_app_link",
    );
  },
);

test.each(pairingLinkBases)("%s malformed pairing links never expose their payload", (base) => {
  expect(describeDaemonTarget({ kind: "endpoint", host: `${base}#offer=private` })).toBe(
    "<invalid endpoint>",
  );
});
