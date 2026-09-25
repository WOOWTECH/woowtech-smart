import { describe, expect, it } from "vitest";
import { BRAND_PAIRING } from "./brand-pairing.js";
import { parseConnectionOfferFromUrl } from "./connection-offer.js";

const OFFER = {
  v: 2,
  serverId: "srv_pairing_test",
  daemonPublicKeyB64: "cGFpcmluZy10ZXN0LWtleQ==",
  relay: { endpoint: "relay.woowtech.io:443", useTls: true },
};
const PAYLOAD = Buffer.from(JSON.stringify(OFFER), "utf8").toString("base64url");

// The CLI's --host and the daemon's exported parser read the offer from the
// fragment with string operations, whatever scheme or host the link has.
describe("reading a woowtech smart pairing link", () => {
  it("finds the offer in the app's own link", () => {
    expect(parseConnectionOfferFromUrl(`${BRAND_PAIRING.appBaseUrl}#offer=${PAYLOAD}`)).toEqual(
      OFFER,
    );
  });

  it("still finds it in a web link a daemon was set to hand out", () => {
    expect(parseConnectionOfferFromUrl(`https://pair.example.test/#offer=${PAYLOAD}`)).toEqual(
      OFFER,
    );
  });

  it("finds no offer in the app's plain root URL", () => {
    expect(parseConnectionOfferFromUrl(BRAND_PAIRING.appBaseUrl)).toBeNull();
  });
});
