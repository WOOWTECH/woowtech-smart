// woowtech smart: tests for woowtech-notification-fallback.ts (woowtech/README.md section 16).
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttentionDisplayFailureTarget } from "@getpaseo/protocol/woowtech-attention-fallback";
import {
  forgetNotificationDisplayFailureForTest,
  getNotificationDisplayFailedThisLaunch,
  handleOsNotificationResult,
  subscribeToNotificationDisplayFailure,
  type AttentionDisplayFailureReporter,
} from "./woowtech-notification-fallback";

const target: AttentionDisplayFailureTarget = {
  kind: "agent",
  agentId: "agent-b",
  timestamp: "2026-10-05T05:00:00.000Z",
};

function createDaemon(options: { supportsFallback: boolean; rejects?: boolean }) {
  const reports: AttentionDisplayFailureTarget[] = [];
  const client: AttentionDisplayFailureReporter = {
    supportsAttentionDisplayFallback: () => options.supportsFallback,
    reportAttentionDisplayFailure: async (reported) => {
      reports.push(reported);
      if (options.rejects) {
        throw new Error("Transport not connected");
      }
      return { requestId: "req-1", outcome: "pushed" };
    },
  };
  return { client, reports };
}

afterEach(() => {
  forgetNotificationDisplayFailureForTest();
  vi.restoreAllMocks();
});

describe("a notice the system did not show", () => {
  it("is reported to the daemon, which then pushes it", async () => {
    const { client, reports } = createDaemon({ supportsFallback: true });

    await handleOsNotificationResult({ shown: false, native: false, client, target });

    expect(reports).toEqual([target]);
    expect(getNotificationDisplayFailedThisLaunch()).toBe(true);
  });

  it("is not reported when the system showed it", async () => {
    const { client, reports } = createDaemon({ supportsFallback: true });

    await handleOsNotificationResult({ shown: true, native: false, client, target });

    expect(reports).toEqual([]);
    expect(getNotificationDisplayFailedThisLaunch()).toBe(false);
  });

  it("is never reported from a phone, which only shows pushes", async () => {
    const { client, reports } = createDaemon({ supportsFallback: true });

    await handleOsNotificationResult({ shown: false, native: true, client, target });

    expect(reports).toEqual([]);
    expect(getNotificationDisplayFailedThisLaunch()).toBe(false);
  });

  it("is not sent to a daemon that does not know the request", async () => {
    const { client, reports } = createDaemon({ supportsFallback: false });

    await handleOsNotificationResult({ shown: false, native: false, client, target });

    expect(reports).toEqual([]);
    expect(getNotificationDisplayFailedThisLaunch()).toBe(true);
  });

  it("does not throw when the report cannot reach the daemon", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client, reports } = createDaemon({ supportsFallback: true, rejects: true });

    await expect(
      handleOsNotificationResult({ shown: false, native: false, client, target }),
    ).resolves.toBeUndefined();

    expect(reports).toEqual([target]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("tells the sidebar callout once per launch", async () => {
    const { client } = createDaemon({ supportsFallback: true });
    const calls: boolean[] = [];
    subscribeToNotificationDisplayFailure(() => {
      calls.push(getNotificationDisplayFailedThisLaunch());
    });

    await handleOsNotificationResult({ shown: false, native: false, client, target });
    await handleOsNotificationResult({ shown: false, native: false, client, target });

    expect(calls).toEqual([true]);
  });
});
