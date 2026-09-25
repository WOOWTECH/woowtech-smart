import { expect, test } from "vitest";
import { describeDaemonTarget } from "./daemon-target.js";

// A pairing link works like a password. CLI messages that name a --host target hide
// its offer, also in woowtech smart's own links (woowtech-smart:///#offer=…).
test("descriptions hide the offer of the app's pairing link", () => {
  expect(describeDaemonTarget({ kind: "endpoint", host: "woowtech-smart:///#offer=private" })).toBe(
    "woowtech-smart:///#REDACTED",
  );
});
