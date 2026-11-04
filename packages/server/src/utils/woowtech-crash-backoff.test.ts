import { describe, expect, it } from "vitest";
import { createCrashBackoff } from "./woowtech-crash-backoff.js";

describe("crash backoff", () => {
  it("restarts the first crash at once and slows down crashes in a row", () => {
    const backoff = createCrashBackoff();
    expect(
      [500, 500, 500, 500, 500, 500, 500, 500].map((uptime) => backoff.nextDelayMs(uptime)),
    ).toEqual([0, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
  });

  it("starts over after a worker ran long enough", () => {
    const backoff = createCrashBackoff();
    backoff.nextDelayMs(100);
    backoff.nextDelayMs(100);
    expect(backoff.nextDelayMs(100)).toBe(2_000);
    expect(backoff.nextDelayMs(60_000)).toBe(0);
    expect(backoff.nextDelayMs(100)).toBe(1_000);
  });

  it("uses the configured limits", () => {
    const backoff = createCrashBackoff({ baseDelayMs: 10, maxDelayMs: 25, stableUptimeMs: 50 });
    expect([1, 1, 1, 1].map((uptime) => backoff.nextDelayMs(uptime))).toEqual([0, 10, 20, 25]);
  });
});
