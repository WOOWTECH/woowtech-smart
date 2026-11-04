import { describe, expect, test } from "vitest";
import { redactAppDiagnosticReport } from "./app-diagnostic-report";

// woowtech smart: a pairing link works like a password, since whoever holds it can pair with the
// daemon, and a diagnostics report leaves the device. Reports already hid the app's own links
// whole. Pairing links now open the hosted web app (https://smart.woowtech.io/#offer=…), so the
// offer is hidden wherever a link carries one; the rest of the link stays readable.
const OFFER_PAYLOAD = Buffer.from(
  JSON.stringify({
    v: 2,
    serverId: "srv_offer_redaction",
    daemonPublicKeyB64: "b2ZmZXItcmVkYWN0aW9uLWtleQ",
    relay: { endpoint: "relay.woowtech.io:443", useTls: true },
  }),
).toString("base64url");
const WEB_LINK = `https://smart.woowtech.io/#offer=${OFFER_PAYLOAD}`;

describe("pairing links in an app diagnostics report", () => {
  test("hide the offer of a web app link and keep the rest of the line", () => {
    expect(redactAppDiagnosticReport(`Opened ${WEB_LINK} from the camera`, [])).toBe(
      "Opened https://smart.woowtech.io/#offer=[redacted] from the camera",
    );
  });

  test("hide the offer inside quotes, JSON and markup, and on any host", () => {
    const redacted = redactAppDiagnosticReport(
      [
        `{"url":"${WEB_LINK}"}`,
        `<a href='${WEB_LINK}'>pair</a>`,
        `https://pair.example.test/#OFFER=${OFFER_PAYLOAD}`,
      ].join("\n"),
      [],
    );

    expect(redacted).not.toContain(OFFER_PAYLOAD);
    expect(redacted.split("\n")).toEqual([
      '{"url":"https://smart.woowtech.io/#offer=[redacted]"}',
      "<a href='https://smart.woowtech.io/#offer=[redacted]'>pair</a>",
      "https://pair.example.test/#offer=[redacted]",
    ]);
  });

  test("still hide the app links of older QR codes whole", () => {
    expect(redactAppDiagnosticReport(`woowtech-smart:///#offer=${OFFER_PAYLOAD}`, [])).toBe(
      "woowtech-smart://[redacted]",
    );
  });
});
