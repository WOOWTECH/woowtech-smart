import { describe, expect, it } from "vitest";
import { BRAND_PAIRING } from "./brand-pairing.js";
import { BRAND_WEB_APP } from "./brand-web-app.js";
import { parseConnectionOfferFromUrl } from "./connection-offer.js";

const OFFER = {
  v: 2,
  serverId: "srv_pairing_test",
  daemonPublicKeyB64: "cGFpcmluZy10ZXN0LWtleQ==",
  relay: { endpoint: "relay.woowtech.io:443", useTls: true },
};
const PAYLOAD = Buffer.from(JSON.stringify(OFFER), "utf8").toString("base64url");

// woowtech smart's pairing links open its hosted web app (owner decision D2, 2026-10-26).
describe("woowtech smart's pairing link defaults", () => {
  it("send pairing links to the hosted web app's origin", () => {
    expect(BRAND_PAIRING.appBaseUrl).toBe(BRAND_WEB_APP.origin);
    expect(BRAND_WEB_APP.origin).toBe("https://smart.woowtech.io");
    // The daemon's CORS check compares the browser's Origin header as a string, and a
    // browser's origin has no path and no trailing slash.
    expect(new URL(BRAND_WEB_APP.origin).origin).toBe(BRAND_WEB_APP.origin);
  });

  it("show a web app link as the example pairing link", () => {
    expect(BRAND_PAIRING.linkExample).toBe(`${BRAND_WEB_APP.origin}/#offer=...`);
  });
});

// The CLI's --host and the daemon's exported parser read the offer from the
// fragment with string operations, whatever scheme or host the link has.
describe("reading a woowtech smart pairing link", () => {
  it("finds the offer in the hosted web app's link", () => {
    expect(parseConnectionOfferFromUrl(`${BRAND_PAIRING.appBaseUrl}/#offer=${PAYLOAD}`)).toEqual(
      OFFER,
    );
  });

  it("still finds it in the app links of older QR codes", () => {
    expect(
      parseConnectionOfferFromUrl(`${BRAND_PAIRING.appSchemeRootUrl}#offer=${PAYLOAD}`),
    ).toEqual(OFFER);
  });

  it("still finds it in a web link a daemon was set to hand out", () => {
    expect(parseConnectionOfferFromUrl(`https://pair.example.test/#offer=${PAYLOAD}`)).toEqual(
      OFFER,
    );
  });

  it.each([BRAND_PAIRING.appBaseUrl, BRAND_PAIRING.appSchemeRootUrl])(
    "finds no offer in the plain root URL %s",
    (rootUrl) => {
      expect(parseConnectionOfferFromUrl(rootUrl)).toBeNull();
    },
  );
});
